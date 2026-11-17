# Security policy

Faithful renders design files and web pages in a headless browser. Treat a design you did not
make like any other untrusted web content: Faithful runs its scripts.
The page can read the design's own folder and, when the design names root-absolute assets
(`/assets/logo.png`), the nearest folder above it that holds them; it can also reach the
network, as any web page can.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on
[appadmin-oss/faithful](https://github.com/appadmin-oss/faithful/security/advisories/new).
Do not open a public issue.

We aim to acknowledge a report within three working days and to agree a disclosure date with
you.

## Supported versions

Only the latest minor release receives fixes while Faithful is at 0.x.
