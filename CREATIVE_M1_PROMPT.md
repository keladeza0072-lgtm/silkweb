You are implementing Milestone 1 of SilkWeb Creative MVP.

Read CREATIVE_MVP.md and AGENTS.md before coding.
The Creative MVP contract governs the new creative application.
Preserve all existing SilkWeb infrastructure.

TASK:
Create apps/creative-studio/ as a standalone,
locally runnable Creative Studio application.

TECHNOLOGY:
- Node.js 24
- TypeScript backend
- Plain HTML, CSS, JavaScript frontend
- Minimal dependencies
- No external frontend frameworks required

DESIGN:
- Sky Blue #0593C6
- White #FCFFFF
- Hot Pink #D83995
- Premium glassmorphism
- Immersive editorial aesthetic
- Responsive desktop and mobile layouts
- Accessible controls and readable typography

FEATURES:
1. Premium branded navigation and dashboard.
2. Campaign brief form with brand, product, audience,
   objective, offer, and creative direction.
3. Six configurable advertising-style selections.
   Use clearly labeled temporary slots if exact
   style names are not provided.
4. Photography mode selector:
   Product, Lifestyle, Website.
5. Campaign workspace with designated areas for:
   - Two creative concepts
   - Two generated images
   - Creative evaluation
   - Advertising policy review
   - Landing-page preview
6. Clear disabled/not-connected states for all
   features requiring AI model inference.
7. Responsive UI and basic input validation.
8. Local health endpoint and minimal tests.
9. README with exact startup instructions.

BOUNDARIES:
- Do not invoke any external AI API.
- Do not implement image generation yet.
- Do not invent generated campaign results.
- Do not invent creative evaluation scores.
- Do not expose secrets.
- Do not modify existing Studio, MCP, registry,
  booking application, experiments, or benchmarks.
- Do not install unnecessary dependencies.
- Do not modify files outside apps/creative-studio/.
- Do not make Git commits.
- Do not create additional worktrees.
- Keep the implementation small and maintainable.

VALIDATION:
Run local build and tests where dependencies permit.
Report completed files, validation results, limitations,
and exact commands needed to launch the application.

Prioritize a polished, working application shell
over unnecessary abstractions.
