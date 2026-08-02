# Product Specification

## 1. Product summary

Seating Plan Helper is a lightweight browser application for teachers to model a classroom, import a student roster, place students manually, or generate seating-plan suggestions that respect pedagogical constraints.

The core monthly workflow is:

1. Open or import a reusable classroom template.
2. Import or paste the current class roster.
3. Configure student rules and preferences.
4. Place students manually or generate three suggestions.
5. Review scores and unresolved preferences.
6. Fine-tune the selected plan.
7. Export a polished classroom map.
8. Optionally export the complete project as JSON for future reuse.

The application must remain usable without authentication and without sending student information to a server.

---

## 2. Product principles

### 2.1 Zero-friction access

The application opens directly into the product. There is no account creation, login wall, cloud setup, or mandatory tutorial.

### 2.2 Local-first privacy

Names, constraints, layouts, logos, and generated seating plans remain in the browser. No student data is uploaded to application infrastructure.

### 2.3 Portable ownership

Users can export their work as files and later import it on another device. The browser may keep an autosaved recovery draft, but exported files are the durable source of truth.

### 2.4 Flexible room modeling

The room editor must support arbitrary classroom arrangements rather than assuming rows of individual desks.

### 2.5 Explainable suggestions

Automatic generation must not behave like a black box. Each suggestion receives a score, a constraint summary, and a list of unmet soft preferences.

---

## 3. Target users

Primary user: a teacher who creates one or more classroom seating plans each month and currently does this manually in Canva, Google Docs, PowerPoint, or similar tools.

Secondary users may include coordinators, substitute teachers, and schools that want reusable branded layouts without adopting a student-data platform.

---

## 4. Core concepts

### 4.1 Project

A project is the complete editable document. It contains:

- room canvas settings;
- room objects;
- seating groups and seats;
- regions;
- roster;
- student constraints and preferences;
- current assignments;
- generation settings;
- export layout and branding.

A project can be exported and imported as JSON.

### 4.2 Room template

A room template contains only reusable physical and visual structure:

- canvas dimensions and orientation;
- seating groups and seats;
- board, door, teacher desk, water fountain, and custom objects;
- regions;
- optional branding and export-label arrangement.

It excludes the roster and current assignments unless the user explicitly exports the whole project.

### 4.3 Seating group, or “center”

A center is a logical group of seats placed together, such as four desks arranged as an island. A center may have any practical number of seats.

Each center has:

- id and optional visible label;
- position, dimensions, and rotation;
- one or more seats;
- optional region membership;
- optional tags.

### 4.4 Seat

A seat is an assignable position with coordinates relative to its center or the room. Seats can face any supported direction.

### 4.5 Room object

A room object is a non-student element used for visual output or proximity constraints.

Built-in types:

- board;
- door;
- teacher desk;
- water fountain;
- window;
- cabinet;
- custom object.

Users can create custom objects with a name, icon or simple shape, dimensions, position, and rotation.

### 4.6 Region

A region is a named area of the room. Examples:

- front;
- middle;
- back;
- left;
- right;
- front center;
- near door.

Regions may be rectangular or polygonal. They can overlap. A seat may belong to multiple regions based on its center point.

### 4.7 Constraint and preference

A **required constraint** must be satisfied for a solution to be considered valid.

A **soft preference** contributes to the score but may be violated if no perfect solution exists.

---

## 5. Main application areas

### 5.1 Start screen

Provide immediate actions:

- New project;
- Start from template;
- Import project JSON;
- Recover local draft, when available.

Include several built-in room templates, such as:

- rows of individual desks;
- pairs;
- groups of four;
- mixed centers;
- blank room.

### 5.2 Room editor

The room editor is desktop-first and supports:

- free positioning;
- optional visible grid;
- snap-to-grid;
- smart alignment guides;
- zoom and pan;
- multi-select;
- duplicate;
- delete;
- bring forward/send backward where relevant;
- rotation in 90-degree increments;
- numeric position and dimension editing;
- undo and redo.

Users can add:

- individual seats;
- prebuilt centers with 2, 3, 4, 5, or 6 seats;
- a custom center with a configurable number and arrangement of seats;
- built-in room objects;
- custom objects;
- named regions;
- text labels.

The room must support either landscape or portrait orientation and configurable logical dimensions. The UI should use logical canvas units rather than requiring real-world measurements.

### 5.3 Roster editor

Supported roster-entry methods:

- type names directly;
- paste one name per line;
- paste comma-, semicolon-, or tab-separated names;
- import CSV.

Minimum CSV support:

```csv
name
João
Maria
```

Optional columns may be accepted but are not required for the MVP. The import preview must let the user choose which column contains the name.

Roster features:

- add, rename, and remove students;
- reorder alphabetically or manually;
- detect and warn about duplicate names;
- preserve Unicode and accents;
- show assigned and unassigned counts;
- optionally assign a display color for readability, without inferring sensitive attributes.

### 5.4 Manual placement mode

Users can drag a student onto an empty seat, move them between seats, or return them to the unassigned list.

Required behaviors:

- swapping when dropping onto an occupied seat;
- optional lock/pin for a student-seat assignment;
- multi-select and clear assignments;
- real-time indication of violated required constraints and soft preferences;
- keyboard-accessible assignment controls in addition to drag and drop.

### 5.5 Rules editor

Rules can target a student, a pair or set of students, a region, a center, or a room object.

#### Student placement rules

- Must be in a named region.
- Prefer a named region.
- Must not be in a named region.
- Must be near a specific room object.
- Prefer being near a specific room object.
- Must be far from a specific room object.
- Must occupy a fixed seat.
- Prefer a particular seat.

“Front,” “middle,” and “back” should use named regions rather than hard-coded row assumptions.

#### Relationship rules

- Students must not be in the same center.
- Students should not be in the same center.
- Students must not be in adjacent centers.
- Students must maintain a minimum distance.
- Students should be far apart.
- Students must be near each other.
- Students should be near each other.
- Students must be in the same center.
- Students should be in the same center.

A pair rule can be created quickly by selecting two students. Group rules may apply the same relation to every pair in the selected set.

#### Distance semantics

The UI exposes human-friendly levels:

- same center;
- adjacent;
- near;
- far;
- custom minimum distance.

The implementation derives these from seat or center coordinates. The rule editor should preview what the selected threshold means on the room canvas.

#### Rule priority

Every rule has:

- severity: required or preferred;
- optional weight for preferred rules;
- enabled/disabled state;
- short user-visible explanation.

### 5.6 Suggestion mode

The user requests automatic generation after the room and roster are valid.

The generator returns up to three distinct suggestions. Each suggestion shows:

- overall score from 0 to 100;
- whether all required constraints were satisfied;
- number of satisfied and violated preferences;
- concise explanation of major tradeoffs;
- a preview of the seating map.

The user can:

- apply a suggestion;
- compare suggestions;
- lock selected students or seats;
- regenerate only unlocked assignments;
- request another set of suggestions;
- switch to manual mode for final adjustments.

If required constraints are impossible, the app must not silently ignore them. It should report that no fully valid arrangement was found and identify likely conflicting rules. It may offer best-effort previews clearly marked invalid.

### 5.7 Export designer

The output should be suitable for school use without further editing in another application.

Supported export formats:

- PNG;
- SVG;
- PDF;
- browser print;
- project JSON;
- room-template JSON;
- roster CSV.

The export designer allows users to configure and position:

- school logo;
- school name;
- class or grade;
- month and year;
- teacher name;
- plan title;
- optional notes or legend;
- board label and other room-object labels;
- footer.

Users may upload a logo image. It is embedded in the local project JSON as a data URL or equivalent encoded asset so the file remains portable.

Export settings include:

- page size, initially A4 and Letter;
- portrait or landscape;
- margins;
- show/hide room objects;
- show/hide seats or chairs;
- font size scaling;
- student-name wrapping or abbreviation;
- background transparency for PNG/SVG where supported.

The app should warn when names overlap or become unreadably small.

---

## 6. Templates

Built-in templates are immutable starting points. Users can customize them and export their own templates.

Each template may include:

- a room layout;
- predefined centers;
- front/middle/back regions;
- common objects;
- default export composition.

Template import must validate schema version and reject malformed files with a clear explanation.

---

## 7. Local persistence and privacy

The application has no authentication and no cloud persistence.

Permitted local behavior:

- autosave one or more recovery drafts in browser storage;
- restore the last session after refresh or accidental tab closure;
- explicitly clear local data;
- display approximate local storage usage.

The UI must state that browser data can be cleared and that exporting JSON is necessary for reliable long-term reuse.

No analytics event may include student names, project content, uploaded logos, or rule data.

---

## 8. Mobile behavior

The full application remains functional on mobile, but room construction is optimized for desktop and tablet.

Mobile priorities:

- open and inspect a plan;
- import/paste a roster;
- configure common rules;
- generate suggestions;
- move or swap individual students;
- export or share the result.

Mobile editor behaviors:

- pinch to zoom;
- two-finger pan or explicit pan mode;
- tap to select;
- drag handles sized for touch;
- property editing in a bottom sheet;
- no interaction that depends exclusively on hover or right-click.

---

## 9. Validation and edge cases

The application must handle:

- more students than available seats;
- more seats than students;
- empty or duplicated names;
- no room objects for an object-proximity rule;
- deleted objects or regions referenced by rules;
- contradictory required constraints;
- a fixed seat assigned to multiple students;
- imported files from a newer unsupported schema;
- very long names;
- Unicode and accented names;
- export with off-canvas elements;
- local storage quota failure.

Generation is disabled until every student has a unique id and the room contains enough assignable seats. Extra seats are allowed.

---

## 10. Accessibility

- Keyboard navigation for major workflows.
- Visible focus states.
- Sufficient contrast.
- Screen-reader labels for controls.
- Non-color indicators for rule status.
- Reduced-motion support.
- Drag-and-drop alternatives for placement and object movement.

---

## 11. MVP acceptance criteria

The MVP is complete when a user can:

1. Open the site without an account.
2. Create a room from scratch or from a built-in template.
3. Add arbitrary centers, seats, regions, and custom objects.
4. Save and reload the project through JSON.
5. Import at least 25 student names by pasted text or CSV.
6. Place students manually by drag and drop.
7. Define front/back, object proximity, same-center, adjacency, and distance rules.
8. Mark each rule required or preferred.
9. Generate three distinct suggestions with scores and explanations.
10. Lock assignments and regenerate the remaining seats.
11. Export a branded, readable map as PNG, SVG, PDF, and print output.
12. Recover an interrupted session from local browser storage.
13. Complete the principal workflows on a phone, even if room editing is more efficient on desktop.

---

## 12. Explicit non-goals

Not part of the MVP:

- accounts or authentication;
- cloud database;
- synchronization across devices;
- collaborative editing;
- direct integration with school information systems;
- attendance, grades, or behavior tracking;
- mandatory offline/PWA installation;
- optimization using seating plans from previous months.

---

## 13. Future features

The project schema should leave room for, but not implement yet:

- monthly plan history inside an exported project;
- penalties for repeating the same center, neighbor, or room zone;
- balancing how often each student sits in front, middle, or back;
- teacher-defined historical fairness rules;
- import/export of rule presets;
- multiple rooms and classes in one bundle;
- optional installable PWA behavior;
- localization beyond the initial language set.
