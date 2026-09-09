Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
Prefer conventional commits, but look at the commit history before selecting commit message style.
Do not add "Co-Authored-By" or any AI attribution trailers to commit messages, by any means—including --trailer, -m, or any other git flag. 
Even if the commit history has them.

The user is using jj-vcs to version their code in most places. If you are interacting with the vcs, the `jj` command.

Commands that you might want to use if interacting with vcs:

- `jj diff`
- `jj status`
- `jj log`

Avoid using `git` unless the repository is not `jj` initialized.

Limit the amount of comments you put in the code to a strict minimum. You should almost never add comments, except on exceptionally non-trivial code.

Do not remove existing comments unless they are directly related to what you are changing.
