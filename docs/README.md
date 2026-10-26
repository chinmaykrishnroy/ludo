# Documentation

| Guide                              | Contents                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Architecture](ARCHITECTURE.md)    | Client/server boundaries, authoritative game updates, persistence, reconnects and offline play |
| [Bot AI](AI.md)                    | Difficulty policies, search workers, fair randomness and measured results                      |
| [Operations](OPERATIONS.md)        | Configuration, monitoring, moderation, backups and recovery                                    |
| [Container releases](RELEASING.md) | Version tags, image verification, Docker/Kubernetes deployment and GitOps                      |
| [Validation](DELIVERY.md)          | Verified behavior, test evidence and remaining acceptance limits                               |
| [Project review](REVIEW.md)        | Engineering rating, confirmed defects and evidence limits                                      |
| [Engineering backlog](TODO.md)     | Prioritized fixes and acceptance criteria                                                      |
| [Release notes](releases)          | Changes and limitations for each version                                                       |

Implementation details belong here so contributors and self-hosters can understand the system. Examples use placeholders; real environment files, admin tokens, registry credentials, tunnel credentials, private keys, session cookies, databases, recordings, reports and backups must stay outside Git and container build contexts. Sanitise diagnostic logs before sharing them. The public demo URL and published image digests are intentionally public.
