## UI overhaul: cleaner layout, SVG visuals, Visual settings

### What changed
- **Header hero** with state orb, counts and progress, plus summary tiles (Running, Done ring, Cost).
- **Full-row section headers** with running and done counts (`✓ 3 of 5 done`) and a glowing accent line while work runs.
- **Two-line rows**: spinner ring, type, name and time, then tool, tokens and cost.
- **Timeline** as glowing bars on a shared time axis.
- **Band above the prompt** restyled with the same SVG look (terminal keeps plain text).
- Empty state, Done ring, sparkle on finished items.
- **New Visual settings group**: `cleanLayout`, `showTiles`, `glowEffect`, `pulseEffect`. Settings are now grouped Show, Visual, Behavior, Alerts.
- Animations use 1s CSS loops kept in phase across redraws and respect `prefers-reduced-motion`.

### Fixes
- Done tile showed `0/12` when a stale batch was remembered: `tally` now clamps done to the batch total.

### Docs and release
- README: features, options, screenshots refreshed, stale "requires gh auth" line removed.
- Version bumped to 0.2.0 so the release workflow publishes after merge.

### Checks
`claude plugin validate .` passes, `claude plugin test .` 9/9.
