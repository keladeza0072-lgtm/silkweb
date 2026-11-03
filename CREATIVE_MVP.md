# SilkWeb Creative MVP — Implementation Contract

## Objective
Build a working AI-powered advertising creative and landing-page
generation application for the Meta Hackathon.

## Existing infrastructure
Preserve the existing SilkWeb registry, MCP server, Studio,
booking application, and benchmark evidence.

Implement the creative product as an isolated application:
apps/creative-studio/

## Technology
- Node.js 24
- TypeScript
- HTML, CSS, JavaScript
- Minimal dependencies
- Local development first
- Muse Code with Muse Spark 1.3 for approved coding tasks

## Visual identity
- Sky Blue: #0593C6
- White: #FCFFFF
- Hot Pink: #D83995
- Glassmorphism
- Immersive editorial layout
- Responsive desktop and mobile experience

## Creative system
- Library: 42 advertising styles
- MVP active styles: 6
- Copywriting frameworks: 4
- Photography modes: product, lifestyle, website
- Campaign output: 2 concepts and 2 original images
- Evaluation: 7 weighted creative-readiness criteria
- Separate advertising policy review
- Website output: 1 responsive landing page

## MVP workflow
1. User enters a campaign brief.
2. User selects a creative style and photography mode.
3. System generates two distinct creative concepts.
4. System generates two original campaign images.
5. System evaluates creative readiness and advertising policy.
6. User selects a preferred creative direction.
7. System generates a responsive landing page.
8. User previews and exports campaign assets.

## Implementation constraints
- Build incrementally.
- Keep implementation tasks narrowly scoped.
- Do not modify unrelated existing applications.
- Do not modify benchmark results or evidence.
- Do not expose credentials in frontend code.
- Do not initiate paid inference without explicit approval.
- Do not present mock output as real model generation.
- Use explicit request, asset, and spending limits.
- Validate all user input.
- Keep generated content separate from trusted application code.

## First implementation milestone
Create the Creative Studio application shell.

Include:
- Branded responsive interface
- Campaign brief form
- Six configurable creative-style options
- Three photography-mode options
- Campaign workspace and output placeholders
- Clear indication that model generation is not yet connected

Do not implement paid inference during this milestone.
