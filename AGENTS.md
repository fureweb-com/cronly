# Repository instructions

## Language

- Write commit subjects and bodies, pull request titles and descriptions, and repository review comments in English.
- This repository-specific English requirement takes precedence over a global default that requests Korean commit messages.
- Respond to the user in Korean unless they request another language.
- Preserve the intended languages of localized application messages and documentation. The Git and PR language requirement does not require translating localized content into English.

## Commits and pushes

- Keep each commit focused on one purpose, including the code, tests, and documentation needed for that purpose.
- Use a concrete English subject with an appropriate Conventional Commit prefix, such as `fix:`, `feat:`, `refactor:`, `test:`, or `docs:`.
- Include a body explaining the background, changes, validation, and any compatibility or migration implications. A subject alone is insufficient.
- End each new or rewritten commit message with a `Model used:` block. Record the provider, exact model identifier, known version/variant/reasoning settings, and role. List every participating model. If an identifier or setting is not exposed by the runtime, write `Unavailable` rather than guessing.
- After the relevant validation, commit and push task changes before the final response unless the user explicitly requests otherwise.
- Include only task-related changes. Exclude secrets, personal data, local configuration, and temporary artifacts.
- Preserve existing published branches when preparing replacement history on a new branch. Do not force-push or rewrite a shared branch without explicit authorization.
- Confirm that the local and remote branch heads match after pushing, and report the branch and commit hash to the user.

## Pull requests

- Target `main` unless the user specifies another base.
- Describe the final behavior, relevant validation, and migration requirements in English.
- When replacing a PR, link the replacement and close the old PR only after the new PR and its checks are ready.
- Merge or publish only when explicitly requested by the user.
