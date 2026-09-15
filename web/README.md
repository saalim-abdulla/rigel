# Pricing browser prototype

Three UI directions for browsing the normalized Copilot price catalog:

- `?variant=A` — dense analyst table with a provider rail
- `?variant=B` — model-first editorial card gallery
- `?variant=C` — input/output cost map with a linked price list

This is intentionally a throwaway UI prototype. Once a direction is selected, the winner should be rewritten as the real application and the other variants removed from the main branch.

Open `web/index.html` directly, or from the repository root run:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000/web/>. Use the floating switcher or the left/right arrow keys to move between variants.
