# SAP Engagement Cloud – Side Navigation Restructuring

## Status
**Proposal phase complete** – ready for PM alignment and stakeholder sign-off.

---

## Summary

The SAP Engagement Cloud side navigation has grown organically over several years, resulting in inconsistent grouping, discoverability issues, and non-compliance with SAP Fiori Side Navigation design guidelines. This project restructures the menu to improve findability, align with Fiori standards, and make the most of the navigation component's capabilities (navigation groups, navigation items with children, fixed footer).

**Two final proposals** have been developed collaboratively by Tilly and Peti, validated against usage analytics and SAP documentation. The final version will be published after PM alignment.

---

## Resources

| Resource | Link |
|----------|------|
| Interactive prototype | [emartech.github.io/sap-engagement-cloud-menu-restructuring](https://emartech.github.io/sap-engagement-cloud-menu-restructuring/) (password: **newIA**) |
| Figma designs | [Side Navigation – Figma](https://www.figma.com/design/bWt5PjgsIL9Uf4Bs6X74iu/Side-Navigation) |
| Final proposals page | Figma page: "EC:EE Menu Final proposals – 2026.04.21." |
| SAP Fiori Side Navigation guidelines | [SAP Design System – Side Navigation](https://www.sap.com/design-system/fiori-design-web/v1-145/ui-elements/side-navigation/) |

---

## Why This Project

1. **Fiori compliance** – The current menu doesn't fully leverage the SAP Fiori Side Navigation component's structure (navigation groups, collapsible items, fixed footer). Restructuring aligns us with UXC-026 product standards.
2. **Discoverability** – With 50+ menu items in flat or poorly organized groups, users struggle to find features. Navigation groups and collapsible items reduce cognitive load.
3. **Scalability** – The current structure doesn't accommodate new features without creating oversized groups (15+ items in "Channels", 16 in "Management").
4. **Naming clarity** – Several menu items have unclear or outdated names that don't match what users actually do.

---

## Sources Used

### Analytics
- **Unique Page Views (UPV)** and **Page Views (PV)** from production analytics covering all 50+ menu items
- Used for: item ordering within groups, identifying low-usage items, validating group importance

### Research
- **SAP Help Portal** documentation – official categorization of all features (used to validate placement decisions and naming)
- **SAP Fiori Design Guidelines** – Side Navigation component structure, supported hierarchy levels (3), group behavior, best practices
- **Stakeholder input** – comments from Peti (PM) and TillyG (UX) collected throughout the process

### Design exploration
- **18+ variant iterations** explored different structural approaches (flat, grouped, channel-split, progressive)
- **IA scoring system** evaluating: group balance, use of navigation groups, naming intentionality, item completeness
- **Comparative analysis** across variants using the interactive prototype

---

## The Two Final Proposals

### 1. Progressive

Introduces **navigation groups** (Channels, Management) with reorganized navigation items underneath. Renames "Contacts" to "Audiences" to better reflect the feature's scope.

**Structure:**
- Home
- Analytics (7 items)
- Audiences (7 items)
- Automation Programs
- **Channels** (navigation group)
  - BMW Channels
  - Email (5 child items)
  - Mobile (5 child items)
  - Web (2 child items)
  - Other Channels (2 child items)
- **Management** (navigation group)
  - Account Management (7 child items)
  - Content Management (6 child items)
  - Data & Integrations (9 child items)

**Key changes from As-Is:**
- "Contacts" → "Audiences"
- Channels split into Email, Mobile, Web, Other Channels (navigation items with children)
- Management split into Account Management, Content Management, Data & Integrations
- "Add Contact" and "Single Sign-On Setup" removed
- Several items renamed for clarity (e.g., "Event Attribution" → "Conversion Analytics")

### 2. As-Is Flatten

Preserves original naming (Contacts, Content) while adding the same **navigation group** structure for better organization. Most conservative option – minimal user disruption.

**Structure:**
- Home
- Analytics (7 items)
- Automation Programs
- Contacts (8 items)
- Content (6 items)
- **Channels** (navigation group)
  - BMW Channels
  - Email (5 child items)
  - Mobile (5 child items)
  - Web (2 child items)
  - Other Channels (2 child items)
- **Management** (navigation group)
  - Account Management (7 child items)
  - Data Management (9 child items)

**Key changes from As-Is:**
- Navigation groups added (Channels, Management) – items previously in one flat list
- Channel items organized into sub-groups (Email, Mobile, Web, Other)
- Management items organized into sub-groups (Account Management, Data Management)
- No renaming – all original names preserved
- All items kept (nothing removed)

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Use navigation groups (Channels, Management) | Fiori supports 3 levels. Groups reduce cognitive load without adding navigation depth – items still have only 1 child level |
| "Audiences" rename (Progressive only) | Aligns with SAP CDP terminology and reflects that the section covers more than just contact records |
| Content Management absorbs Personalization | Personalization and Omnichannel Voucher are content creation tools, not a separate domain |
| Remove "Add Contact" (Progressive) | Functionality covered by Contacts Page + Contact Lists |
| Item ordering by usage within groups | Most-used items first, with logical sub-grouping (e.g., SMS Campaigns + SMS Settings together) |
| BMW Channels as standalone item | Customer-specific feature, doesn't belong in Email/Mobile/Web/Other |

---

## Process

1. **Audit** – Catalogued all 50+ menu items with usage analytics, SAP categorization, and stakeholder comments
2. **Exploration** – Created 18+ structural variants exploring flat, grouped, channel-split, and progressive approaches
3. **Analysis** – Compared variants using automated IA scoring (balance, depth, naming, completeness) and manual review
4. **Convergence** – Narrowed to 2 proposals through iterative feedback between Tilly and Peti
5. **Validation** – Cross-checked against SAP Fiori guidelines, usage data, and SAP Help Portal categorization
6. **Documentation** – Built interactive prototype for stakeholder review

---

## Implementation Plan

### Phase 1: Structural changes
- Implement navigation groups (Channels, Management)
- Reorganize items into sub-groups (Email, Mobile, Web, Other Channels, Account Management, Data Management/Data & Integrations, Content Management)
- Update menu item ordering

### Phase 2: Naming changes (if Progressive is chosen)
- Rename affected items in UI
- Update documentation, help links, and onboarding materials
- Coordinate with localization team

### Phase 3: Removals (if Progressive is chosen)
- Remove "Add Contact" from navigation (feature still accessible from Contacts page)
- Remove "Single Sign-On Setup" (if confirmed with security team)
- Feature flags for gradual rollout

---

## How to Review

1. Open the [interactive prototype](https://emartech.github.io/sap-engagement-cloud-menu-restructuring/) (password: **newIA**)
2. Enter your name – it will be attached to your feedback
3. Go to the **Shortlist** tab to see both final proposals
4. Click menu items to see details, usage data, and leave comments
5. Use **Compare** view to see differences side by side
6. When done, click **Export Feedback** and send the JSON to TillyG

---

*Document prepared by TillyG & Peti – April 2026*
