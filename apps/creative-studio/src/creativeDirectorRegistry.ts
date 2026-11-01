/**
 * SilkWeb Creative reference intelligence v1.
 * Semantic references, NOT downloaded third-party ad images.
 * A visual guide image is optional; only owned/licensed assets may be attached later.
 * Internal only: the customer never selects styles or frameworks.
 */
export type CreativeFamily = 'human-interaction' | 'situated-lifestyle' | 'studio-still-life' | 'tactile-editorial' | 'in-use-demonstration' | 'graphic-editorial';
export type ProductCategory = 'tech' | 'beauty' | 'fashion' | 'food' | 'home' | 'general';
export type CreativeReference = {
  id: string; family: CreativeFamily; title: string;
  compatible: readonly ProductCategory[];
  objectives: readonly ('drive-sales'|'build-awareness'|'launch-product')[];
  scene: string; interaction: string; camera: string; typography: string;
  rationale: string; risk: string;
  /** Optional approved owned/license-cleared reference image asset ID. */
  visualAsset?: string;
};
const ALL = ['drive-sales','build-awareness','launch-product'] as const;
export const CREATIVE_REFERENCE_REGISTRY_VERSION = 'real-world-references-v1';
export const CREATIVE_REFERENCES: readonly CreativeReference[] = [
 {id:'TECH-HAND-01',family:'human-interaction',title:'Real hand, real scale',compatible:['tech','general'],objectives:ALL,
  scene:'Realistic city commute or café entrance in natural daylight, blurred movement behind subject',
  interaction:'A real adult hand wraps naturally around the product without hiding brand or display; scale is physically believable',
  camera:'Tight documentary mid-close-up, shallow depth of field, actual hand anatomy',
  typography:'Short headline in the quiet side of the photograph; copy is secondary to the moment',
  rationale:'Human contact establishes portability and real-world scale',risk:'Extra fingers, concealed product, implausible scale'},
 {id:'TECH-DESK-02',family:'situated-lifestyle',title:'Everyday carry in context',compatible:['tech','home','general'],objectives:ALL,
  scene:'Natural café or work desk with relevant understated everyday objects, authentic window light',
  interaction:'Product physically rests on a continuous surface with an obvious contact shadow; no magic floating',
  camera:'Natural three-quarter camera slightly above tabletop; product is legible and prominent',
  typography:'Editorial text anchored in actual negative space, not over products or busy props',
  rationale:'Concrete everyday context communicates use without requiring invented specifications',risk:'Stock-photo clichés, clutter, unsupported product connection'},
 {id:'TECH-USE-03',family:'in-use-demonstration',title:'Connected in real use',compatible:['tech'],objectives:['drive-sales','build-awareness'],
  scene:'Plausible working environment, phone and power source in reach, subtle real-life details',
  interaction:'Show use only when the uploaded product visibly supports it; do not invent cables, ports, or claims',
  camera:'Close-up on authentic interaction and physical connections, real hand geometry',
  typography:'Use one explanatory line, outside the interaction area',
  rationale:'Shows function rather than abstract styling',risk:'Hallucinated connectors or unsupported functions'},
 {id:'STUDIO-PROP-04',family:'studio-still-life',title:'Real support, premium lighting',compatible:['tech','beauty','fashion','home','general'],objectives:ALL,
  scene:'A photographic commercial studio with a real stone, wood or acrylic riser, softbox highlights and physical contact shadows',
  interaction:'Product stands or lies on a physically stable support; preserve material properties',
  camera:'Intentional 50–85mm commercial photography perspective, not a 3D diagram',
  typography:'Confident art-directed hero statement with controlled type scale and clear spacing',
  rationale:'Premium attention to product without distracting surreal effects',risk:'Floating props, artificial glossy reflections'},
 {id:'TACTILE-SILK-05',family:'tactile-editorial',title:'Tactile fabric top-down',compatible:['beauty','fashion','tech','home','general'],objectives:ALL,
  scene:'Top-down ivory tabletop with natural textile folds and lateral window light',
  interaction:'Product compresses and rests against tactile cloth with authentic material contact; critical label visible',
  camera:'True overhead editorial flat-lay, realistic fabrics and fine detail',
  typography:'Small refined editorial or serif headline on a quiet neutral plane',
  rationale:'Materials lend warmth and tactility to ordinary products',risk:'Fabric hiding brand; misleading claims about luxury'},
 {id:'BEAUTY-HUMAN-06',family:'human-interaction',title:'Beauty application or hold',compatible:['beauty'],objectives:ALL,
  scene:'Real dressing table or naturally lit beauty environment, subtle natural portrait context',
  interaction:'Hand holds or applies product only where product category and facts support it',
  camera:'Tight editorial beauty photography with genuine skin texture and human scale',
  typography:'Restrained luxury/editorial or playful campaign typography depending on product tone',
  rationale:'Beauty products benefit from relevant beauty context and human expression',risk:'Invented results, skin transformation claims'},
 {id:'BEAUTY-VANITY-07',family:'studio-still-life',title:'Bathroom vanity hero',compatible:['beauty','home'],objectives:ALL,
  scene:'Sunlit vanity or minimalist bathroom surface, authentic ceramic and mirror materials',
  interaction:'Product sits upright where physically stable, with realistic reflection',
  camera:'Clean commercial still life, subtle asymmetry',
  typography:'Sparse editorial messaging following negative space',
  rationale:'Recognizable category context without inappropriate human model',risk:'Unreadable labels or fake ingredient claims'},
 {id:'FOOD-TABLE-08',family:'situated-lifestyle',title:'Authentic food moment',compatible:['food'],objectives:ALL,
  scene:'Honest kitchen or café serving environment with natural light and plausible food styling',
  interaction:'Product is held, poured or served only when packaging and facts permit',
  camera:'Appetizing real food photography with accurate scale',
  typography:'Warm, direct headline; balanced editorial hierarchy',
  rationale:'Authentic consumption contexts communicate category fit',risk:'False ingredients or implausible serving'},
 {id:'FASHION-WORN-09',family:'human-interaction',title:'Wearable editorial story',compatible:['fashion'],objectives:ALL,
  scene:'Real street, home or studio wardrobe context consistent with the item',
  interaction:'Real person wears or carries the original item naturally',
  camera:'Lifestyle fashion editorial, fabric and fit preserved',
  typography:'Minimal expressive typography appropriate to editorial photography',
  rationale:'Shows scale, drape and real product fit',risk:'Body/product distortion'},
 {id:'HOME-IN-SITU-10',family:'situated-lifestyle',title:'Home in use',compatible:['home'],objectives:ALL,
  scene:'Plausible lived-in room with harmonious authentic materials and lighting',
  interaction:'Product sits or is used exactly as it physically should',
  camera:'Interior editorial with a clear subject',
  typography:'Quiet readable hierarchy, avoid blocking the product',
  rationale:'Demonstrates real-world scale and relevance',risk:'Wrong scale or incompatible placement'},
 {id:'CLEAN-CUT-11',family:'graphic-editorial',title:'Minimal editorial cut',compatible:['tech','fashion','beauty','food','home','general'],objectives:ALL,
  scene:'Real product photographed against a simple paper backdrop with restrained physical geometric props',
  interaction:'Product remains fully supported and realistic; no impossible effects',
  camera:'High-resolution commercial studio photograph',
  typography:'Bold asymmetric type, precise baseline and intentional contrast',
  rationale:'Allows typography to communicate a confident creative hook',risk:'Template-looking giant type; typography obscuring product'},
 {id:'TRAVEL-EVERYDAY-12',family:'situated-lifestyle',title:'Travel essentials composition',compatible:['tech','fashion','beauty','general'],objectives:ALL,
  scene:'Well-styled travel bag and essentials on a real tabletop, natural daylight',
  interaction:'Product nestled by the relevant everyday items, physically supported',
  camera:'Authentic editorial overhead or 45-degree product photograph',
  typography:'Compact storytelling copy outside the essentials cluster',
  rationale:'Shows carry context without false technical promises',risk:'Too many props or generic travel cliché'}
];
