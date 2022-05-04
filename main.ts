// SPDX: 0BSD

// Note that this is pretty duct-taped together. Fix it, where you can.
//
// TODO:
//   [ ] - Close files after being sent to user, where applicable.
//   [ ] - Clean up some messy code.
//   [ ] - Fix bugs related to file uploads/moderation that may be present.
//   [ ] - Add proper interfaces/types to objects (Partially done. Still need to do some others, though.)
//   [ ] - Add pinned posts(?)
//   [ ] - API cooldowns(?)
//   [ ] - CORS policy(?)

// External dependencies
import {
  Application,
  Router,
  send,
  Status,
} from "https://deno.land/x/oak/mod.ts";

// Interfaces
interface Reply {
  "id": number | string;
  "posted": string;
  "tripcode": string | null;
  "name": string;
  "content": string | null;
  "attachments": string | null;
  "admin"?: boolean;
}

interface Post {
  "id": number | string;
  "posted": string;
  "tripcode": string | null;
  "name": string;
  "title": string | null;
  "content": string | null;
  "attachments": string;
  "admin"?: boolean;
  "replies": Reply[];
}

// Global Variables
const settingsJSON = await Deno.readTextFile("./settings.json");
const globalConf = JSON.parse(settingsJSON);
const app = new Application();

async function updateBoard(
  board: string,
  maxreplies: number,
  maxposts: number,
) {
  let boardpath: string = `./${globalConf.board_directory}/${board}`;

  // Loop 1: Organize the files, delete last modified one.
  let bi: object[] = []; // Board Items.

  for await (let i of Deno.readDir(boardpath)) {
    if (`${i.name}` == "info.json") {
      continue;
    }

    let ps: string = await Deno.readTextFile(`${boardpath}/${i.name}`); // Page string
    let po: Post = await JSON.parse(ps); // Great argument for interfaces #1

    if (po.replies.length > maxposts) {
      await Deno.remove(`${boardpath}/${i.name}`);
      await Deno.remove(
        `${globalConf.media_directory}/${po.attachments.split("/")[2]}`,
      );
      await po.replies.map(async function (x: Reply) {
        if (x.attachments != null) {
          await Deno.remove(
            `${globalConf.media_directory}/${x.attachments.split("/")[2]}`,
          );
        }
      });
    }

    let fd: any = await Deno.lstat(`${boardpath}/${i.name}`); // file data

    bi.push({
      "name": i.name,
      "mtime": fd.mtime,
    });
  }

  bi.sort(function (x: any, y: any) {
    return new Date(x.time).getTime() - new Date(y.time).getTime();
  });

  if (bi.length > maxposts) {
    let postsToDelete: any = bi.splice(maxreplies, bi.length - maxreplies);

    for (let p in postsToDelete) { // bad posts
      // TODO: Delete all files in thread.
      await Deno.remove(`${boardpath}/${postsToDelete[p].name}`);
    }
  }
}

async function hash(string: string | null): Promise<string | null> {
  if (string == null || string.length == 0) {
    return null;
  }
  const hash = await crypto.subtle.digest(
    "SHA-256",
    (new TextEncoder()).encode(string),
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash))).substr(0, 9);
}

async function filename(path: string, id: string): Promise<string | null> {
  if (
    /.*\.(mp4|png|jpg|jpeg|gif|webm|webp)/.test(path)
  ) {
    let img = await Deno.readFile(path);
    await Deno.writeFile(
      `${globalConf.media_directory}/${id}.${path.split(".")[1]}`,
      img,
    );
    await Deno.remove(path);
    // Writiing the filename like this because I'm a fucking caveman
    return (
      `/media/${id}.${path.split(".")[1]}`
    );
  }
  return null;
}

// Routing shit.
const routes = new Router()
  .get("/", async function (ctx) {
    let res: object[] = [];

    for await (let i of Deno.readDir(`${globalConf.board_directory}`)) {
      if (i.isDirectory) {
        let raw: string = await Deno.readTextFile(
          `${globalConf.board_directory}/${i.name}/info.json`,
        ); // Raw JSON
        let json: any = await JSON.parse(raw);

        res.push({
          "board": i.name,
          "description": json.description,
        });
      }
    }

    ctx.response.body = JSON.stringify(res, null, "  ");
  })
  .get("/boards/:board", async function (ctx) {
    let res: object[] = [];

    for await (
      let i of Deno.readDir(
        `${globalConf.board_directory}/${ctx.params.board}/`,
      )
    ) {
      if (`${i.name}` == "info.json") {
        continue;
      }

      let file: string = await Deno.readTextFile(
        `${globalConf.board_directory}/${ctx.params.board}/${i.name}`,
      );
      let json: Post = await JSON.parse(file);

      let img_replies = 0;

      json.replies.map(async function (x) {
        if (x.attachments != null) img_replies += 1;
      });
      // Add type for this in the future.
      res.push({
        "id": json.id,
        "posted": json.title,
        "title": json.title,
        "content": json.content,
        "attachments": json.attachments,
        "admin": json.admin ?? null,
        "replies": json.replies.length,
        "image_replies": img_replies,
      });
    }

    ctx.response.body = JSON.stringify(res, null, "  ");
  })
  .get("/boards/:board/:thread_id", async function (ctx) {
    try {
      const thread = await Deno.readTextFile(
        `${globalConf.board_directory}/${ctx.params.board}/${ctx.params.thread_id}.json`,
      );
      ctx.response.body = thread;
      ctx.response.status = Status.OK;
    } catch (err) {
      ctx.response.body = { "err": "Not Found." };
      ctx.response.status = Status.NotFound;
    }
  })
  .post("/boards/:board", async function (ctx) {
    // create JSON text file with object bullshit.
    const body = await ctx.request.body();
    const value = await body.value;
    const formData = await value.read();

    let boardfile = await Deno.readTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/info.json`,
    );

    let boardJSON = await JSON.parse(boardfile);
    let img = await Deno.readFile(formData.files[0].filename);

    // Check incoming data first.
    if (
      !formData.files[0] ||
      formData.fields.content.length > boardJSON.max_postlength ||
      !formData.fields.content
    ) {
      ctx.response.body = { "err": "Invalid" };
      ctx.response.status = Status.NotAcceptable;
    }

    if (boardJSON.banned_ips.includes(ctx.request.ip)) {
      ctx.response.body = { "err": "You are banned" };
      ctx.response.status = Status.NotAcceptable;
    }

    // Actually create the post, now.
    let threadID: number = boardJSON.most_recent_post += 1;
    let time = new Date();
    let trip: string | null = await hash(formData.fields.trip);

    let imgID = Math.floor(Math.random() * 1e10);

    const filename = // Writiing the filename like this because I'm a fucking caveman
      `${globalConf.media_directory}/${imgID}.${
        formData.files[0].filename.split(".")[1]
      }`;

    await Deno.writeFile(filename, img);
    await Deno.remove(formData.files[0].filename);

    // TODO: Add admin param if trip is in admin hash list.
    let thread: Post = {
      "id": threadID,
      "posted": time.toISOString(),
      "tripcode": trip,
      "name": formData.name ?? globalConf.default_name,
      "title": formData.title ?? null,
      "content": formData.fields.content ?? null,
      "attachments": `/media/${imgID}.${
        formData.files[0].filename.split(".")[1]
      }`,
      "replies": [],
    };

    if (globalConf.admin_hashes.includes(`${trip}`)) {
      thread.admin = true;
    }

    boardJSON.most_recent_post = threadID;

    // Write affected files
    await Deno.writeTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/${threadID}.json`,
      JSON.stringify(thread, null, "  "),
    );
    await Deno.writeTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/info.json`,
      JSON.stringify(boardJSON, null, "  "),
    );

    // Update the board.
    await updateBoard(
      `${ctx.params.board}`,
      boardJSON.max_replies,
      boardJSON.max_threads,
    );

    ctx.response.redirect(`/boards/${ctx.params.board}/${threadID}`);
  })
  .post("/boards/:board/:thread_id", async function (ctx) {
    // (Largely) Same as above, but with replies.
    const body = await ctx.request.body();
    const value = await body.value;
    const formData = await value.read();

    let boardfile = await Deno.readTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/info.json`,
    );

    let boardJSON = await JSON.parse(boardfile);
    let img = await Deno.readFile(formData.files[0].filename);

    if (
      formData.fields.content.length > boardJSON.max_postlength ||
      !formData.fields.content && !formData.files ||
      img.length > boardJSON.max_filesize ||
      formData.fields.content > boardJSON.max_postlength
    ) {
      ctx.response.body = { "err": "Bad input" };
      ctx.response.status = Status.NotAcceptable;
    }

    if (boardJSON.banned_ips.includes(ctx.request.ip)) {
      ctx.response.body = { "err": "You are banned" };
      ctx.response.status = Status.NotAcceptable;
    }

    let threadID: number = boardJSON.most_recent_post += 1;
    let threadFile = await Deno.readTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/${ctx.params.thread_id}.json`,
    );
    let thread = JSON.parse(threadFile);

    let time = new Date();
    let trip: string | null = await hash(formData.fields.trip);
    let imgID = Math.floor(Math.random() * 1e10);

    let reply: Reply = {
      "id": threadID,
      "posted": time.toISOString(),
      "tripcode": trip,
      "name": formData.name ?? globalConf.default_name,
      "content": formData.fields.content ?? null,
      "attachments": await filename(formData.files[0].filename, `${imgID}`) ??
        null,
    };

    if (globalConf.admin_hashes.includes(`${trip}`)) {
      reply.admin = true;
    }

    thread.replies.push(reply);

    boardJSON.most_recent_post = threadID;

    await Deno.writeTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/${ctx.params.thread_id}.json`,
      JSON.stringify(thread, null, "  "),
    );
    await Deno.writeTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/info.json`,
      JSON.stringify(boardJSON, null, "  "),
    );

    await updateBoard(
      ctx.params.board,
      boardJSON.max_replies,
      boardJSON.max_threads,
    );

    ctx.response.redirect(
      `/boards/${ctx.params.board}/${ctx.params.thread_id}`,
    );
  })
  .delete("/boards/:board/:thread_id", async function (ctx) {
    const body = await ctx.request.body();
    const value = await body.value;
    const formData = await value.read();

    let boardfile = await Deno.readTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/info.json`,
    );

    let threadFile = await Deno.readTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/${ctx.params.thread_id}.json`,
    );
    let thread: Post = await JSON.parse(threadFile);

    let boardJSON = await JSON.parse(boardfile);
    const hashed = await hash(`${formData.pass}`);

    if (globalConf.admin_hashes.includes(`${hashed}`)) {
      await thread.replies.map(async function (x: Reply) {
        if (x.attachments != null) {
          await Deno.remove(
            `${globalConf.media_directory}/${x.attachments.split("/")[2]}`,
          );
        }
      });
      await Deno.remove(`./${ctx.params.board}/${ctx.params.thread_id}.json`);
      await updateBoard(
        ctx.params.board,
        boardJSON.max_replies,
        boardJSON.max_threads,
      );
    } else {
      ctx.response.body = { "error": "not authorized" };
      ctx.response.status = Status.Unauthorized;
    }
  })
  .delete("/boards/:board/:thread_id/:reply_id", async function (ctx) {
    const body = await ctx.request.body();
    const value = await body.value;
    const formData = await value.read();

    let boardfile = await Deno.readTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/info.json`,
    );

    async function getElement(e: any) {
      e.id == ctx.params.reply_id;
    }

    let threadFile = await Deno.readTextFile(
      `${globalConf.board_directory}/${ctx.params.board}/${ctx.params.thread_id}.json`,
    );
    let thread = await JSON.parse(threadFile);

    let boardJSON = await JSON.parse(boardfile);
    let hashed = await hash(formData.fields.pass);
    let arrElement: number = await thread.replies.findIndex(getElement);

    if (globalConf.admin_hashes.includes(`${hashed}`)) {
      await Deno.remove(
        `${globalConf.media_directory}/${
          thread.replies[arrElement].attachments.split("/")[2]
        }`,
      ); // God why
      thread.replies.splice(arrElement, 1);
      await Deno.writeTextFile(
        `${globalConf.board_directory}/${ctx.params.board}/${ctx.params.thread_id}.json`,
        JSON.stringify(thread, null, "  "),
      );
      await updateBoard(
        ctx.params.board,
        boardJSON.max_replies,
        boardJSON.max_threads,
      );
    } else {
      ctx.response.body = { "error": "not authorized" };
      ctx.response.status = Status.Unauthorized;
    }
  })
  .get("/media/:pic", async function (ctx) {
    await send(ctx, `${ctx.params.pic}`, {
      root: `${globalConf.media_directory}`,
    });
  });

app.use(routes.routes());
app.use(routes.allowedMethods());

app.addEventListener(
  "listen",
  (e) => console.log(`Listening on http://localhost:${globalConf.port}`),
);

await app.listen({ port: globalConf.port });
