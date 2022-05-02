<!--This probably has something in it that I removed/didn't impliment while actually programming the damn thing.-->

# fs-chan

`fs-chan` is a filesystem-based imageboard software.

## Architecture

Everything in `fs-chan` is built off the filesystem. Each board is represented
as a directory, and each thread in said board is its own JSON file. Global
variables are read from the boards `settings.json` file.

### Example Board Tree

```
b                # Board name.
├── 1.json       # Each of these are threads, with their IDs as filenames.
├── 2.json       # This has one reply (ID: 3). This affects the next post, as you'd expect. 
├── 4.json       # See?
└── info.json    # Board settings. We'll talk more about this later.
```

## API

> `GET /boards/` Return a JSON formatted list of site boards, and their
> descriptions.

> `GET /:board` Return a 'catalog', which is a JSON pseudofile showing all
> threads in the board, the number of replies, and media files in said thread.

> `GET /:board/:thread_id` Retrive an entire thread, as a json format.

> `POST /:board` Add a thread. (Requires at least _some_ text, and a media
> file.)

> `POST /:board/:thread_id` Reply to a thread.

> `DELETE /:board/:thread_id` Delete a thread (Requires a password, more on that
> later.)

> `DELETE /:board/:thread_id/:reply_id` Delete a reply from a thread (Also
> requires a password.)

> `GET /media/:image` Retrive a media file on the thread. 

## `settings.json`

Global site configuration.

- `admin_hashes`: Hashes for admin level stuff. When deleting a reply/thread,
  the hash must be included in the `pass` variable. This is probably insecure,
  but whatever.

- `banned_ips`: Banned IP addresses. Must be added manually, as of right now.

- `board_directory`: Directory location for site boards.

- `media_directory`: Where user-submitted files are kept. Default is `/media/`.

- `default_name`: What a post with no `name` parameter will automatically revert
  to.

- `port`: What port the server should run on.

## `info.json`

Basically `settings.json`, but on a board-level scope, instead of a site-wide
one.

- `description`: A breif overview of what the board is about.

- `banned_ips`: Same as in `settings.json`, but on a board-only scope.

- `forced_anon`: Will revert all poster names to `default-name`, if set to true.

- `max_threads`: Maximum threads a board can have.

- `max_replies`: Maximum replies a thread can have.

- `max_files`: Maximum files a thread can have.

- `max_filesize`: Maximum size a user submitted file can be (in bytes).

- `max_postlength`: Maximum characters a post can have.

- `most_recent-post`: Numerical ID of most recent post submitted to board.

## License

0BSD.
