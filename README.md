# Sonomzy

Personal Jekyll site hosted with GitHub Pages.

## Publishing without Git

This repository is configured for [Pages CMS](https://pagescms.org/).

1. Open https://app.pagescms.org/
2. Sign in with GitHub.
3. Install/authorize the Pages CMS GitHub App for the `sonomzy` account if prompted.
4. Open `sonomzy/sonomzy.github.io`.
5. Choose **Posts** and click **New entry**.
6. Add the title, publish date, optional description and post content.
7. Save/publish. Pages CMS commits the post to GitHub and GitHub Pages rebuilds the site automatically.

Images uploaded through the CMS are stored in `assets/images/`.

## Content structure

- `_posts/` — blog posts
- `about.markdown` — About page
- `assets/images/` — uploaded images
- `.pages.yml` — Pages CMS configuration
- `_config.yml` — Jekyll site settings

## Custom domain

When a custom domain is chosen, add it in **GitHub → Repository Settings → Pages → Custom domain**, update the DNS records with the domain provider, and update the `url` value in `_config.yml`.
