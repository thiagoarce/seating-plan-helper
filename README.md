# Seating Plan Helper

A browser-based tool for creating classroom layouts and generating seating plans with pedagogical constraints.

## Product principles

- **Zero barriers:** no account, authentication, onboarding gate, or backend dependency.
- **Privacy by design:** student data never leaves the user's device.
- **Portable data:** classroom layouts, rosters, branding, constraints, and plans can be imported/exported as JSON or CSV.
- **Desktop first, mobile capable:** the full workflow works in modern browsers, with layout editing optimized for desktop/tablet.
- **Fast monthly workflow:** reuse a classroom template, import a roster, generate or adjust the plan, and export a polished result.

## MVP

- Free-form classroom editor with snapping, optional grid, zoom, pan, and 90-degree rotation.
- Reusable templates plus arbitrary seat groups and custom room objects.
- Manual student placement by drag and drop.
- Automatic generation of three scored suggestions.
- Required constraints and soft preferences.
- Import names from pasted text or CSV.
- Export/import project data as JSON.
- Export the final plan as PNG, SVG, PDF, and printable layout.
- Configurable title, labels, logo, colors, and branding.
- Local draft recovery only; no cloud persistence.

Detailed requirements are in [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) and [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md).

## Non-goals for the MVP

- Authentication or user accounts.
- Cloud storage or synchronization.
- Multi-user collaboration.
- Mandatory PWA/offline installation.
- Historical optimization across previous months; the data model should permit this later.
