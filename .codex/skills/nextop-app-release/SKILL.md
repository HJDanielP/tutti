---
name: nextop-app-release
description: "Set up, review, or fix an external repository so it can publish a Nextop workspace app through the reusable Nextop App Release GitHub Actions workflow. Use when a user asks how to reuse the Nextop App Release pipeline, create a caller workflow, publish a remote App Center app, configure S3/CloudFront release hosting, run @tutti-os/app-release-tools, validate nextop.app.json release packages, or debug release metadata/latest.json/catalog publication issues. This skill is self-contained for external app repositories and does not assume access to the nextop monorepo docs."
---

# Nextop App Release

Use this skill when an external app repository needs to publish a Nextop workspace app into App Center release metadata.

The external repository calls the reusable workflow from the Nextop repository:

```yaml
uses: tutti-os/tutti/.github/workflows/publish-nextop-app-release.yml@main
```

That workflow builds the external app package, runs `@tutti-os/app-release-tools`, creates a zip plus release metadata, and uploads the result to S3.

Publishing an app release is not the same as publishing the shared App Center catalog. A release writes the app's `latest.json`; a catalog publish reads one or more `latest.json` files and writes `catalog.json`.

## Release Contract

The caller repository must be compatible with pnpm. The reusable workflow runs `pnpm install --frozen-lockfile` before `package_command`, so the repository should commit `pnpm-lock.yaml` and define the scripts used by `package_command`.

The caller repository must produce one complete Nextop app package directory. The package directory must contain:

- `nextop.app.json`
- `bootstrap.sh`
- `AGENTS.md`
- the manifest icon asset, such as `icon.svg`
- all implementation files and assets needed at runtime

The manifest must use `schemaVersion: "nextop.app.manifest.v1"`. Its `appId` must match the workflow `app_id` input. Its `version` is used as the base release version when the caller does not pass `release_version`.

The workflow writes release objects under:

```text
apps/<appId>/<version>/
apps/<appId>/latest.json
```

By default, `<version>` is:

```text
<bumped manifest.version>
```

For example, manifest version `0.1.0` becomes `0.1.1` with the default
`version_bump: patch`. If `auto_bump_version` is disabled, the fallback version
is `<manifest.version>+<short git sha>`, such as `0.1.0+abcdef123456`.

## Caller Workflow

Create a workflow in the external app repository, usually `.github/workflows/publish-nextop-app-release.yml`:

```yaml
name: Publish Nextop App Release

on:
  workflow_dispatch:

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    uses: tutti-os/tutti/.github/workflows/publish-nextop-app-release.yml@main
    with:
      app_id: your-app-id
      package_command: pnpm build:nextop-app
      package_dir: dist/nextop-app/your-app-id
      auto_bump_version: true
      version_bump: patch
      publish_catalog: true
      aws_region: us-east-1
      aws_role_arn: ${{ vars.NEXTOP_APP_RELEASE_AWS_ROLE_ARN }}
      s3_bucket: ${{ vars.NEXTOP_APP_RELEASE_S3_BUCKET }}
      s3_prefix: nextop-app-releases-staging
      release_assets_base_url: https://cdn.example.com/nextop-app-releases-staging
```

Important trigger guidance for generated app repositories:

- Use only `workflow_dispatch` when releases should be manual.
- Add a `push` trigger for `main` only when merging to the main branch should
  automatically publish a new app release.
- Do not add both staging and production `push` triggers to the same branch
  unless every main-branch merge is intended to publish both environments.
- Be explicit in generated workflow comments because app repositories are often
  AI-generated and may otherwise publish on every merge unintentionally.

Example automatic production trigger:

```yaml
on:
  workflow_dispatch:
  push:
    branches:
      - main
```

Use a pinned ref instead of `@main` when the caller needs release reproducibility:

```yaml
uses: tutti-os/tutti/.github/workflows/publish-nextop-app-release.yml@<tag-or-commit-sha>
```

## Required Inputs

- `app_id`: App id for the release. Must match `nextop.app.json` `appId`.
- `aws_region`: AWS region used by the release bucket.
- `aws_role_arn`: IAM role assumed through GitHub OIDC.
- `s3_bucket`: Bucket receiving release files.

Optional inputs:

- `package_command`: Shell command that builds or copies the final app package. Required unless `catalog_only` is true.
- `package_dir`: Directory produced by `package_command`; must contain the complete app package. Required unless `catalog_only` is true.
- `release_assets_base_url`: Public HTTP(S) base URL corresponding to the S3 root plus prefix. Required unless `catalog_only` is true.
- `icon_path`: Override icon file path when the manifest icon asset should not be used.
- `auto_bump_version`: Whether the workflow should update and commit the app manifest version before publishing. Defaults to `true`.
- `version_bump`: Semver bump applied when `auto_bump_version` is true. Defaults to `patch`; supported values are `major`, `minor`, and `patch`.
- `release_version`: Explicit release version. Use sparingly because it bypasses automatic version bumping.
- `version_manifest_path`: Manifest file to bump before packaging. Defaults to `nextop.app.json`.
- `publish_catalog`: Whether to merge this app release into the shared catalog after release upload. Defaults to `false`.
- `catalog_only`: Whether to skip app packaging/release upload and only merge the existing `apps/<appId>/latest.json` into `catalog.json`. Defaults to `false`.
- `catalog_cloudfront_distribution_id`: Optional CloudFront distribution id to invalidate after automatic catalog upload.
- `runner`: GitHub runner label. Default is `ubuntu-latest`.
- `node_version`: Default is `24`.
- `pnpm_version`: Default is `10.11.0`.
- `release_tools_package`: Default is `@tutti-os/app-release-tools@latest`.
- `s3_prefix`: Prefix under the bucket. Use separate prefixes for staging and production.

## Staging And Production

Keep staging and production release metadata separate.

Recommended staging values:

```yaml
s3_prefix: nextop-app-releases-staging
release_assets_base_url: https://cdn.example.com/nextop-app-releases-staging
```

Recommended production values:

```yaml
s3_prefix: nextop-app-releases
release_assets_base_url: https://cdn.example.com/nextop-app-releases
```

Do not publish staging app releases into the production prefix. The shared catalog publisher must read production releases only from the production prefix and staging releases only from the staging prefix.

## Catalog Publication

After an app release is uploaded, App Center sees it only after the shared catalog includes that app id.

Set `publish_catalog: true` on the release workflow to automatically merge the
released app into `catalog.json` after upload. Automatic catalog publishing uses
the same S3 bucket and prefix as the app release, serializes jobs by bucket and
prefix to avoid concurrent merge overwrites, verifies the merged catalog, and
optionally invalidates `catalog.json` when `catalog_cloudfront_distribution_id`
is provided.

Set `catalog_only: true` to skip packaging and release upload, then merge the
existing `apps/<appId>/latest.json` from S3 into `catalog.json`. Use this for
repairing or refreshing catalog state after an app release already exists.

Retrying an existing release version is allowed only when the existing
immutable `release.json` matches the newly generated release metadata. Matching
retries repair mutable state such as `latest.json`, catalog metadata, and
CloudFront invalidation without re-uploading immutable artifacts.

The Nextop repository owns catalog publication workflows:

- Production catalog: `.github/workflows/publish-nextop-app-catalog.yml`
  - Run link: <https://github.com/tutti-os/tutti/actions/workflows/publish-nextop-app-catalog.yml>
- Staging catalog: `.github/workflows/publish-nextop-app-catalog-staging.yml`
  - Run link: <https://github.com/tutti-os/tutti/actions/workflows/publish-nextop-app-catalog-staging.yml>

When telling a user that they need to publish or refresh the catalog, include
the relevant run link directly so they can click through to GitHub Actions.
Also include the recommended inputs:

- `catalog_mode`: `merge` for normal app release publication or catalog refresh; `replace` only for deliberate full catalog replacement.
- `app_ids`: set to the released remote app id for normal merge publishing. In merge mode, it may be left empty to re-upload the existing catalog and invalidate CloudFront without changing the app set.
- Leave `aws_region`, `aws_role_arn`, `s3_bucket`, `s3_prefix`, and `cloudfront_distribution_id` empty unless the repo variables need to be overridden.

Built-in apps are not published through the remote catalog workflow. Do not add
built-in app ids such as `automation` to catalog publication inputs.

These workflows are run from the Nextop repository, not from each external app repository. They:

1. Read `catalog_mode` to choose merge or replace behavior.
2. Read optional remote app ids from `app_ids` when provided.
3. In merge mode, download the existing `catalog.json` from S3 when present.
4. Download each selected `apps/<appId>/latest.json` from S3.
5. Build `nextop.app.catalog.v1`; merge mode preserves existing apps, replace mode publishes only selected apps.
6. Upload `catalog.json` to the same S3 prefix.
7. Optionally invalidate the CloudFront `catalog.json` path.

Use the manual catalog workflows for repair, refresh, or deliberate replace
operations. For normal app release publication, prefer `publish_catalog: true`
on the app release workflow.

Production catalog inputs:

- `catalog_mode`: required choice; defaults to `merge`. Use `replace` only when publishing the complete selected app set.
- `app_ids`: optional comma-separated or newline-separated remote app ids. In merge mode, an empty value refreshes the existing catalog when one already exists. In replace mode, at least one app id is required.
- `aws_region`: optional; defaults to `vars.NEXTOP_APP_RELEASES_AWS_REGION`.
- `aws_role_arn`: optional; defaults to `vars.NEXTOP_APP_RELEASES_AWS_ROLE_ARN`.
- `s3_bucket`: optional; defaults to `vars.NEXTOP_APP_RELEASES_S3_BUCKET`.
- `s3_prefix`: optional; defaults to `vars.NEXTOP_APP_RELEASES_S3_PREFIX`.
- `cloudfront_distribution_id`: optional; defaults to `vars.NEXTOP_APP_RELEASES_CLOUDFRONT_DISTRIBUTION_ID`.

Staging catalog inputs use staging defaults first:

- `aws_region`: defaults to `vars.NEXTOP_APP_RELEASES_STAGING_AWS_REGION`, then `vars.NEXTOP_APP_RELEASES_AWS_REGION`.
- `aws_role_arn`: defaults to `vars.NEXTOP_APP_RELEASES_STAGING_AWS_ROLE_ARN`, then `vars.NEXTOP_APP_RELEASES_AWS_ROLE_ARN`.
- `s3_bucket`: defaults to `vars.NEXTOP_APP_RELEASES_STAGING_S3_BUCKET`, then `vars.NEXTOP_APP_RELEASES_S3_BUCKET`.
- `s3_prefix`: defaults to `vars.NEXTOP_APP_RELEASES_STAGING_S3_PREFIX`, then `nextop-app-releases-staging`.
- `cloudfront_distribution_id`: defaults to `vars.NEXTOP_APP_RELEASES_STAGING_CLOUDFRONT_DISTRIBUTION_ID`, then `vars.NEXTOP_APP_RELEASES_CLOUDFRONT_DISTRIBUTION_ID`.

Catalog publication writes:

```text
s3://<s3_bucket>/<s3_prefix>/catalog.json
```

Use this sequence:

1. External app repository publishes the app release to staging.
2. Nextop repository publishes the staging catalog using the staging run link, usually with `catalog_mode: merge` and `app_ids: <released-app-id>`.
3. Verify App Center against the staging catalog URL.
4. External app repository publishes the production app release.
5. Nextop repository publishes the production catalog using the production run link, usually with `catalog_mode: merge` and `app_ids: <released-app-id>`.

If `catalog.json` is updated but App Center still shows old metadata, check CloudFront cache invalidation and confirm `NEXTOP_APP_CATALOG_URL` points at the expected staging or production catalog URL.

## AWS Requirements

The caller repository needs an AWS IAM role that GitHub Actions can assume through OpenID Connect.

The role must allow writing release files to:

```text
s3://<s3_bucket>/<s3_prefix>/apps/<appId>/<version>/*
s3://<s3_bucket>/<s3_prefix>/apps/<appId>/latest.json
```

When `publish_catalog` is enabled, the role must also allow reading and writing:

```text
s3://<s3_bucket>/<s3_prefix>/catalog.json
```

When `catalog_cloudfront_distribution_id` is set, the role must allow creating
invalidations for that CloudFront distribution.

The caller workflow must grant:

```yaml
permissions:
  contents: write
  id-token: write
```

`contents: write` is required for the default automatic version bump commit. A
caller that disables `auto_bump_version` and manages versions elsewhere may use
`contents: read`, but release uploads still refuse to overwrite an existing
immutable version.

Store non-secret configuration such as role ARN and bucket name in GitHub Actions variables when possible. Use secrets only for values that are actually secret. OIDC-based AWS auth should not require long-lived AWS access keys.

## Package Command Rules

The package command should be deterministic and should leave the final app package at `package_dir`.

Good examples:

```yaml
package_command: pnpm build:nextop-app
package_dir: dist/nextop-app/weather-dashboard
```

```yaml
package_command: pnpm build && pnpm package:nextop-app
package_dir: dist/nextop-app
```

The called reusable workflow already runs `pnpm install --frozen-lockfile` before `package_command`. Do not duplicate install work unless the external repository has a specific reason.

## Local Validation

Before relying on GitHub Actions, validate the package locally:

```sh
pnpm --package @tutti-os/app-release-tools@latest dlx build-nextop-app-release \
  --app-id your-app-id \
  --package-dir dist/nextop-app/your-app-id \
  --output-dir /tmp/nextop-app-release \
  --base-url https://cdn.example.com/nextop-app-releases-staging \
  --version 0.1.0+local \
  --git-sha local
```

Expected output:

- `/tmp/nextop-app-release/apps/<appId>/<version>/<appId>-<version>.zip`
- `/tmp/nextop-app-release/apps/<appId>/<version>/release.json`
- `/tmp/nextop-app-release/apps/<appId>/latest.json`

## Completion Checklist

Before finishing a setup or review:

- The external workflow uses `tutti-os/tutti/.github/workflows/publish-nextop-app-release.yml`.
- The workflow has `contents: write` and `id-token: write` permissions when automatic version bumps are enabled.
- The caller repository commits `pnpm-lock.yaml`.
- Unless `catalog_only` is enabled, `package_command` produces `package_dir`.
- Unless `catalog_only` is enabled, `package_dir/nextop.app.json` exists and is valid JSON.
- Unless `catalog_only` is enabled, manifest `appId` matches workflow `app_id`.
- Unless `catalog_only` is enabled, manifest icon `src` points to an existing package-local asset, or `icon_path` is provided.
- Unless `catalog_only` is enabled, `bootstrap.sh` and `AGENTS.md` exist in `package_dir`.
- `s3_prefix` and `release_assets_base_url` describe the same public release root.
- Staging releases use a staging prefix and production releases use a production prefix.
- The IAM role can write immutable version files and mutable `latest.json`.
- If `publish_catalog` is enabled, the release workflow can write `catalog.json` in the same S3 bucket and prefix, and optional CloudFront invalidation uses the matching distribution id.
- If `publish_catalog` is disabled, the matching Nextop catalog workflow will usually run in merge mode with the released remote app id included in `app_ids`.
- If `catalog_only` is enabled, `apps/<appId>/latest.json` already exists in the target S3 bucket and prefix.

## Common Failures

- `manifest appId must match app id`: change workflow `app_id` or manifest `appId` so they match exactly.
- `missing nextop.app.json`: fix `package_command` or `package_dir`; the workflow packages only `package_dir`.
- `manifest icon asset missing`: add the asset inside the app package or pass `icon_path`.
- AWS `AccessDenied`: check the OIDC role trust policy, role ARN, bucket policy, region, and prefix permissions.
- Broken download URLs: make `release_assets_base_url` match the public URL for `s3_bucket` plus `s3_prefix`.
- Release appears uploaded but not visible in App Center: the app release exists, but the shared catalog still needs to include that app's `latest.json`.
