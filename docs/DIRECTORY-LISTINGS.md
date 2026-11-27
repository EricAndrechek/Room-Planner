# Listing Room Planner in the assistant directories

Ready-to-paste copy and a checklist for the **Claude Connectors Directory** and the **ChatGPT app
directory**. There is also a no-review option: a **ChatGPT Custom GPT** built on the REST API.
Requirements were read on 2026-11-25 from:

- Claude: [Submit a connector](https://claude.com/docs/connectors/building/submission) and
  [review criteria](https://claude.com/docs/connectors/building/review-criteria)
- ChatGPT: [Submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines),
  [Submit plugins](https://developers.openai.com/plugins/deploy/submission) and
  [ChatGPT UI](https://developers.openai.com/plugins/build/chatgpt-ui). OpenAI now calls listings
  "plugins".

Re-check them before you submit, because both change often. Items marked **Owner** need the
owner's accounts or identity, so only the owner can do them.

## Shared facts

| Field                | Value                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP server URL       | `https://room-planner.andrechek.com/mcp` (Streamable HTTP, stateless, both protocol eras)                                                                                                                                                                                                                                                                                                                             |
| Authentication       | None. The tools only compute; nothing is stored.                                                                                                                                                                                                                                                                                                                                                                      |
| Website              | https://room-planner.andrechek.com                                                                                                                                                                                                                                                                                                                                                                                    |
| Documentation        | https://room-planner.andrechek.com/agents/                                                                                                                                                                                                                                                                                                                                                                            |
| Privacy policy       | https://room-planner.andrechek.com/privacy/                                                                                                                                                                                                                                                                                                                                                                           |
| Terms of use         | https://room-planner.andrechek.com/terms/                                                                                                                                                                                                                                                                                                                                                                             |
| Support              | https://room-planner.andrechek.com/support/ (GitHub issues: https://github.com/EricAndrechek/Room-Planner/issues)                                                                                                                                                                                                                                                                                                     |
| Icon                 | `public/pwa-512x512.png` (512 × 512 PNG); `public/favicon.svg` (SVG); `public/maskable-icon-512x512.png`                                                                                                                                                                                                                                                                                                              |
| Brand colour         | `#4f46e5` (6.3:1 against white); for dark, `#818cf8` (5.4:1 against `#212121`)                                                                                                                                                                                                                                                                                                                                        |
| Carousel screenshots | Owner. Run `MCP_SHOTS_DIR=<dir> pnpm exec playwright test e2e/mcp.spec.ts --project=chromium --workers=2 -g carousel` to get `carousel-1-bedroom.png`, `carousel-2-living-room.png`, `carousel-3-flat.png` and `carousel-4-holiday-dinner.png` (1100 px wide PNGs of the plan viewer, the app response only, from the clean plans in `worker/showcase.ts`; the prompts that make them are in `carousel-prompts.txt`). |
| Allowed link URIs    | `https://room-planner.andrechek.com` (the viewer's Open in Room Planner opens only this origin)                                                                                                                                                                                                                                                                                                                       |
| Tools                | `create_plan`, `check_layout`, `read_plan`; each has a `title`, `readOnlyHint: true`, `destructiveHint: false` and `openWorldHint: false`                                                                                                                                                                                                                                                                             |

### Name and descriptions

- **Name:** Room Planner
- **One line (Claude, 200 characters max):** Lay out a room or a whole floor to scale, check it for
  clashes and blocked doors, and get a link that opens the plan in a free floor-plan editor.
- **Subtitle (ChatGPT, 30 characters max):** Plan rooms to scale (20 characters)
- **Long description** (it fits both: Claude allows 2,000 characters, ChatGPT 4,000):

  > Room Planner turns a description of a room into a floor plan drawn to scale. Tell the
  > assistant your room's size, where the doors and windows are, and what furniture you have or
  > want; it writes the plan, checks it, and shows you the drawing in the chat, with any problems
  > marked: pieces that overlap, furniture in a door's swing or doorway, pieces outside the room,
  > and walkways that are too tight. One button opens the plan in Room Planner, a free editor in
  > the browser, where you can drag and rotate everything, measure, export a PDF or image, and
  > share a link.
  >
  > It handles a single bedroom or a whole flat: several rooms joined by doors, L-shaped and other
  > room shapes, round and L-shaped furniture, and pieces you set aside for later. Use feet and
  > inches or metric. Paste a Room Planner link into the chat and the assistant can change your
  > existing plan.
  >
  > What it does not do: it doesn't measure your room (you give it the sizes), it doesn't sell
  > furniture, and it draws in 2D from above. No account; your plans stay in your browser. The
  > server processes each plan in memory and keeps none of them.

- **Categories:**
  - Claude (pick 1 to 5): Productivity; Design; Lifestyle (or the nearest names in the portal).
  - ChatGPT: Productivity (Design if it is offered).

### Example prompts

The first three are short enough to use as ChatGPT's `defaultPrompt` entries (128 characters max).

1. Plan my 11 × 12 ft bedroom with a queen bed, two nightstands, a dresser and a desk.
2. Lay out a 350 × 400 cm living room with a sofa facing the TV, a coffee table and two armchairs.
3. Here's my Room Planner link: (paste). Move the desk under the window and check the door is clear.
4. Plan a small flat: a 12 × 14 ft living room with a 10 × 11 ft bedroom to its right and a door
   between them. Put in a sofa, a round dining table for four and a bed, and set a spare
   armchair aside.

## Claude Connectors Directory

Submit at [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** →
**MCP connector**. It is listed as a Community connector after an automated scan.

| Requirement                                                                        | How Room Planner meets it                                                                                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote server over HTTPS                                                           | `https://room-planner.andrechek.com/mcp`                                                                                                       |
| Authentication: OAuth for user data, otherwise none                                | None: public computation, no user data                                                                                                         |
| Every tool has a `title` and `readOnlyHint` or `destructiveHint`                   | All three; checked by `worker/http.test.ts`                                                                                                    |
| Tool names of 64 characters or fewer                                               | 11 to 12 characters                                                                                                                            |
| Narrow, accurate descriptions with no prompt-injection patterns                    | The descriptions state the format and the result. They tell the model nothing beyond how to use the result (the link must be passed on whole). |
| Actionable errors with valid parameters                                            | Invalid plans come back as a tool error naming each field path                                                                                 |
| Responses of reasonable size                                                       | The plan, its issues and a summary. The drawing is made in the client (MCP Apps), not sent as an image.                                        |
| No conversation data beyond the tool's need                                        | Only the plan is sent; analytics record counts, never content (`/privacy/`)                                                                    |
| First-party API, domain matches the service                                        | The server is the site's own Worker                                                                                                            |
| Privacy policy, documentation, support contact                                     | `/privacy/`, `/agents/`, `/support/`                                                                                                           |
| MCP App: 3 to 5 carousel PNGs, 1000 px or wider, response only, each with a prompt | **Owner:** generate them as above, then pair each with its prompt from `carousel-prompts.txt`                                                  |
| Allowed link URIs (optional, for `ui/open-link`)                                   | `https://room-planner.andrechek.com`                                                                                                           |
| Tested in Claude as a custom connector and with MCP Inspector                      | **Owner:** custom connector (the PR's "How to try it"); Inspector transcripts were made on the preview                                         |
| Any paid Claude plan to submit                                                     | **Owner**                                                                                                                                      |
| Company name and website, primary contact                                          | **Owner:** Eric Andrechek, https://room-planner.andrechek.com, the owner's own contact (not published)                                         |
| Use cases, prerequisites, data access                                              | Room layout and furniture planning; no prerequisites; reads nothing and writes nothing (it computes and returns)                               |
| Data handling                                                                      | Own service; no health data; no sponsored content                                                                                              |
| Seven compliance acknowledgments                                                   | **Owner**                                                                                                                                      |
| Listing slug (permanent)                                                           | `room-planner`                                                                                                                                 |

## ChatGPT app directory

Submit through the [OpenAI Platform dashboard](https://platform.openai.com) → Apps/Plugins. Only
organisation owners, or members with **Apps Management Write**, can submit.

| Requirement                                                                                | How Room Planner meets it                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified individual or organisation                                                        | **Owner:** finish identity verification in [organisation settings](https://platform.openai.com/settings/organization/general)                                                             |
| Public HTTPS MCP server, auth none/OAuth                                                   | `/mcp`, no auth                                                                                                                                                                           |
| Domain verification: token as plain text at `/.well-known/openai-apps-challenge`           | **Owner:** copy the token from the dashboard; then add `public/.well-known/openai-apps-challenge` (only the token) and a `Content-Type: text/plain` rule in `public/_headers` (DEPLOY.md) |
| `readOnlyHint`, `destructiveHint`, `openWorldHint` explicit on every tool                  | All three set; checked by `worker/http.test.ts`                                                                                                                                           |
| Tool names unique, verbs, no promotional words                                             | `create_plan`, `check_layout`, `read_plan`                                                                                                                                                |
| Descriptions match behaviour, state limits                                                 | Yes                                                                                                                                                                                       |
| UI: `ui.resourceUri` (`openai/outputTemplate` still honoured), `text/html;profile=mcp-app` | Both keys on `create_plan` and `read_plan`, plus `openai/toolInvocation/invoking`/`invoked` status text                                                                                   |
| CSP allowlists limited to what is needed                                                   | `_meta.ui.csp` with empty `connectDomains` and `resourceDomains`: the viewer fetches and loads nothing                                                                                    |
| No iframes in the UI                                                                       | None                                                                                                                                                                                      |
| Works on desktop and mobile                                                                | The viewer is responsive (360 px and wider), follows the host theme, and passes axe                                                                                                       |
| Privacy policy: categories, purposes, recipients, retention, controls                      | `/privacy/`                                                                                                                                                                               |
| Minimal data; no tracking unless disclosed and controllable                                | IP and location data for analytics are disclosed on `/privacy/`; the website's analytics can be turned off                                                                                |
| General audience (13+), no ads, no digital goods                                           | Yes                                                                                                                                                                                       |
| URLs: website, support, privacy, terms (HTTPS)                                             | See "Shared facts"                                                                                                                                                                        |
| Name 30 characters max, no "MCP" or "Plugin"                                               | "Room Planner"                                                                                                                                                                            |
| Logo: square, 48 px or larger, PNG/SVG                                                     | `public/pwa-512x512.png`                                                                                                                                                                  |
| Up to 3 `defaultPrompt` entries, 128 characters max                                        | Prompts 1 to 3 above                                                                                                                                                                      |
| Exactly 5 positive and 3 negative test cases                                               | Below                                                                                                                                                                                     |
| Demo video of the test cases                                                               | **Owner:** record the five positive cases in ChatGPT developer mode                                                                                                                       |
| Reviewer credentials                                                                       | None needed (no auth)                                                                                                                                                                     |
| Countries                                                                                  | All (leave empty)                                                                                                                                                                         |

### Test cases

Positive (prompt, then the tools it triggers and what to expect):

1. "Plan my 11 × 12 ft bedroom: door on the bottom wall near the left corner, window centred on
   the top wall. Fit a queen bed, two nightstands and a dresser." Triggers `check_layout`, then
   `create_plan`. The drawing appears, problems (if any) are listed, and Open in Room Planner
   opens the plan.
2. "Lay out a 350 × 400 cm living room with a three-seat sofa facing a TV stand, a coffee table and
   two armchairs, with 90 cm walkways." Triggers `create_plan`, in centimetres, with no overlaps.
3. "Plan a flat: a 12 × 14 ft living room and a 10 × 11 ft bedroom to its right with a door
   between them; a sofa, a round table for four, a bed, and a spare armchair set aside."
   Triggers `create_plan`. Two rooms are drawn with their names, and the armchair is listed under
   "Set aside".
4. "Here is my plan: <a Room Planner link>. Move the desk under the window." Triggers `read_plan`,
   then `create_plan`. The changed plan comes back with a new link.
5. "Check this layout for problems: <a Room Planner link with an overlap>." Triggers `read_plan`.
   The overlap is reported with the pieces named.

Negative (Room Planner should not act):

1. "What's a good paint colour for a north-facing bedroom?" This is decor advice, not a layout.
2. "Buy me a queen bed under $500." Shopping; Room Planner sells nothing.
3. "Draw a picture of a cosy living room." An image, not a floor plan to scale.

## ChatGPT Custom GPT (no review, works today)

Any ChatGPT Plus user can make a GPT that uses the REST API (Explore GPTs → Create).

- **Name:** Room Planner
- **Description:** Lay out rooms to scale and get a link that opens the plan in a free editor.
- **Instructions:**

  > You help people lay out rooms and furniture. Write the plan in Room Planner's format (see the
  > createPlanLink schema; lengths in the user's unit). Call checkLayout and fix every error and
  > warning, then call createPlanLink and give the user the url as Markdown link text, such as
  > [Open your bedroom in Room Planner](url). Never show the raw URL. To change a plan the user
  > pastes, call readPlanLink with it first.

- **Conversation starters:** the example prompts above.
- **Actions:** Create new action → Import from URL → `https://room-planner.andrechek.com/openapi.json`;
  Authentication: None; Privacy policy: `https://room-planner.andrechek.com/privacy/`.
- **Capabilities:** none needed (the API does the work). Publishing the GPT to the GPT Store
  needs a verified builder profile (**Owner**).
