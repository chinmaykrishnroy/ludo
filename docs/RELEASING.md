# Container releases and GitOps

Pushing a tag such as `v0.1.8` builds and publishes `ghcr.io/chinmaykrishnroy/ludo` for Linux AMD64 and ARM64. Images can run on Docker hosts, Kubernetes and other compatible container platforms.

## Release procedure

1. Update package.json and package-lock.json to the desired version, and add `docs/releases/vX.X.X.md`.
2. Commit/push the change to main and validate it.
3. Create an annotated version tag and push it:

```sh
git tag -a v0.1.8 -m "Ludo Club v0.1.8"
git push origin v0.1.8
```

The tag must match the package and lockfile versions and point at a commit on origin/main. The pipeline reruns Linux/Windows tests, builds, dependency audit and the existing container checks. It then builds **each architecture separately**, runs HTTP/PWA, multiplayer, persisted restart/reconnect and AI worker smoke checks against that actual image, and pushes architecture candidates.

Only after both candidates pass does it assemble the version manifest. It checks that the manifest contains exactly the tested architecture digests, verifies anonymous registry access, publishes the immutable plain version alias and creates a GitHub release with the digest and image metadata. Publication jobs share one queue (up to 100 pending); architecture builds can still run concurrently. After publication, numeric stable-version ordering promotes only the newest published release to GHCR `latest` and GitHub Latest. An older build finishing later keeps its versioned image/release without downgrading either alias. Drafts and prereleases are excluded. These guarantees apply to this workflow; manually pushing mutable aliases or rerunning an obsolete workflow can bypass them.

For v0.1.8 the pull references are:

```sh
docker pull ghcr.io/chinmaykrishnroy/ludo:v0.1.8
docker pull ghcr.io/chinmaykrishnroy/ludo:0.1.7
docker pull ghcr.io/chinmaykrishnroy/ludo:latest
```

Use new, increasing versions for future releases. Published version tags are not overwritten. If publication or latest promotion is interrupted, rerun only the failed publish job; it can resume when the existing manifest still matches the tested candidates. A changed candidate digest requires a new version rather than replacing a release.

GitHub initially creates new container packages as private. If the anonymous-access gate fails on the first release, the owner must change the package visibility to Public in GitHub Package settings, then rerun the failed publish job. Once public, the registry can be pulled without an imagePullSecret. Do not put credentials or game data into the build context; .dockerignore excludes them. The workflow uses the repository's short-lived GITHUB_TOKEN, with write permissions confined to publishing jobs.

## Kubernetes and GitOps

The example base at `deploy/k8s` uses the versioned image, one replica, a persistent volume, Recreate updates, health probes and an unprivileged container. It is a template, not a deployment to your cluster.

Keep **one authoritative replica** with SQLite. A Docker multi-architecture image provides hardware compatibility, not multi-server game ownership. Recreate avoids running two owners against the same volume during updates. Prefer storage with reliable local SQLite locking; do not assume an arbitrary network filesystem is safe for WAL.

Before syncing, create the `ludo` namespace and a `ludo-server` Secret outside Git. Supply a random ADMIN_TOKEN of at least 32 characters, ALLOWED_ORIGINS for the exact HTTPS hostname, PUBLIC_ROOMS_ENABLED as desired, and TRUST_PROXY_CIDRS containing only your actual ingress/tunnel proxy hops. Keep the secret out of the source repository. The base intentionally requires this Secret rather than embedding a working credential.

Render the example with `kubectl kustomize deploy/k8s` and review it before applying it. It can also be copied into a deployment repository/overlay managed by Argo CD, Flux or another GitOps controller. The ClusterIP Service is `ludo.ludo.svc.cluster.local:3000`; route your HTTPS ingress or tunnel connector to it. The example asks the default storage class for 10 GiB and uses smaller database/audio caps to leave room for backups. Confirm available storage and back up off-host before using it.

For automatic, auditable updates, change `newTag` in kustomization.yaml to the new release (or use its digest) and commit that manifest change. A configured GitOps controller then observes the Git change and rolls the Deployment. Optional tools such as Argo CD Image Updater can automate version selection; the release pipeline does not alter a cluster or another deployment repository.

`latest` is available, but **a registry tag changing does not itself change a Kubernetes Deployment**. `imagePullPolicy: Always` pulls on pod creation; it does not restart existing pods. Using latest therefore needs an external rollout trigger. Version/digest pinning gives controlled updates and rollback.

To roll back, restore the previous version/digest in the deployment configuration and apply or sync it. Review schema compatibility first; a binary rollback cannot undo an incompatible database migration. Preserve the persistent volume and use a verified backup into a new database filename when data recovery is required.

## Current release limits

See `docs/DELIVERY.md` and `docs/AI.md`. Shared-Pi testing still shows occasional long room-action pauses. Publishing an image does not claim that those storage/host latency issues are resolved or that maximum capacity has been established.
