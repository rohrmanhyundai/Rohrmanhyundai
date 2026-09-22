Subject: Purge cached commits after sensitive-data history rewrite — rohrmanhyundai/Rohrmanhyundai

Hello,

On 2026-09-21 we rewrote the history of the public repository
rohrmanhyundai/Rohrmanhyundai to remove leaked credentials and force-pushed
the result (all branches: main, claude/fervent-feistel-1f5cc4,
claude/strange-murdock-268265, claude/xenodochial-khayyam-d306fd).

The removed content included plaintext user passwords and obfuscated API
tokens in public/data/users.json, dist/data/users.json and the dist/ folder.

Please run garbage collection / purge the unreachable objects and any cached
views (commit pages, raw URLs, PR diffs) so the old commits no longer resolve
by SHA. There are no forks of the repository.

Thank you.
