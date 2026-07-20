# Claim-page accessibility

The server-rendered claim pages use landmarks, one page heading, descriptive titles and buttons, native forms/links, visible keyboard focus, high-contrast dark and light palettes, status text with `role=status`/`aria-live`, and reduced-motion handling. Terminal expired, cancelled, failed, claimed, and reconciliation states are explained in text rather than color. QR output has descriptive alternative text and an equivalent GNU Taler link/instruction.

Pages have no script requirement, cookies, analytics, remote fonts, or third-party assets, and request no recipient identity. The bearer warning is adjacent to the URI/QR. The CSP permits only local/data images and inline CSS.

Remaining work: independent WCAG 2.2 AA review, assistive-technology testing across current browsers, localization, and user research with recipients unfamiliar with GNU Taler. Automated or maintainer review is not independent accessibility validation.
