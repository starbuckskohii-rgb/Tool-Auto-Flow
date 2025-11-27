export const MARKETS = [
    { code: 'US', name: 'USA (Âu Mỹ)' },
    { code: 'BR', name: 'Brazil (Nam Mỹ)' },
    { code: 'JP', name: 'Japan (Nhật Bản)' },
    { code: 'KR', name: 'Korea (Hàn Quốc)' }
];

export const ideaMatrix: Record<string, any> = {
    jesus: {
        tone: ["Solemn (Trang nghiêm)", "Hopeful (Hy vọng)", "Tragic (Bi kịch)", "Miraculous (Phép màu)", "Peaceful (Bình yên)", "Intense (Kịch tính)", "Joyful (Hân hoan)", "Mystical (Huyền bí)", "Sorrowful (Đau buồn)", "Redemptive (Cứu chuộc)"],
        setting: ["Desert (Sa mạc)", "Sea of Galilee (Biển hồ)", "Ancient Temple (Đền thờ cổ)", "Olive Garden (Vườn ô liu)", "Busy Market (Chợ đông đúc)", "Humble Carpenter Shop", "Stormy Sea", "Mountain Top", "Roman Palace", "Poor Village", "River Jordan", "Cave Tomb", "Wheat Field", "Fishing Boat", "City Gate", "Well", "Wedding Feast", "Synagogue", "Wilderness", "Upper Room"],
        action: ["Teaching crowd", "Healing sick", "Praying alone", "Walking on water", "Breaking bread", "Carrying cross", "Washing feet", "Calming storm", "Turning tables", "Calling disciples"],
        camera: ["Wide shot (Toàn cảnh)", "Close-up on eyes (Cận mắt)", "Low angle (Góc thấp)", "Tracking shot (Đi theo)", "Over the shoulder", "Drone shot (Flycam)", "Handheld (Rung nhẹ)", "Rack focus", "Silhouette", "Slow motion"],
        lighting: ["Divine Rays (God rays)", "Soft Candlelight", "Harsh Desert Sun", "Moonlight", "Stormy Grey", "Sunset Gold", "Dawn Blue", "Firelight", "Torches", "Ethereal Glow"]
    },
    trending: {
        tone: ["Energetic", "Melancholic", "Dreamy", "Edgy", "Romantic", "Nostalgic", "Dark", "Playful", "Inspirational", "Chill"],
        setting: ["Neon City Street", "Abandoned Warehouse", "Golden Hour Field", "Luxury Apartment", "Subway Station", "Rooftop at Night", "Beach at Sunset", "Snowy Forest", "Vintage Diner", "Modern Art Gallery", "Skate Park", "Bedroom", "Rainy Window", "Car Interior", "Desert Road", "Poolside", "Old Library", "Graffiti Wall", "Flower Garden", "Foggy Bridge"],
        action: ["Dancing", "Running", "Staring at camera", "Walking away", "Laughing", "Crying", "Driving", "Playing instrument", "Reading", "Smoking (artistic)"],
        camera: ["Fast cuts", "One-shot (Long take)", "Reverse motion", "Glitch effect", "Fish-eye lens", "Dolly zoom", "Dutch angle", "Top-down", "POV", "360 rotation"],
        lighting: ["Neon Pink/Blue", "Golden Hour", "Black & White", "Strobe Lights", "Soft Pastel", "Dark & Moody", "High Contrast", "Lens Flare", "Natural Sunlight", "Projection Mapping"]
    },
    looping: {
        tone: ["Calm", "Meditative", "Uplifting", "Mysterious", "Vibrant", "Soothing", "Dynamic", "Abstract", "Ethereal", "Focus"],
        setting: ["Nhà thờ trong thành phố", "Đường phố đông đúc nhộn nhịp", "Dòng người hành hương", "Thánh đường lộng lẫy", "Flowing River", "Clouds Moving", "Candle Flame", "Wheat Field in Wind", "Ocean Waves", "Forest Canopy", "City Traffic (Time-lapse)", "Starry Night", "Bonfire", "Rain on Leaves", "Mountain Mist", "Abstract Shapes", "Flower Blooming", "Ink in Water", "Smoke Swirls", "Galaxy", "Snow Falling", "Dust Particles", "Light Leak", "Waterfall"],
        action: ["Continuous Flow", "Slow Rotation", "Gentle Sway", "Pulsing Light", "Rising Smoke", "Falling Particles", "Rippling Water", "Blooming", "Fading In/Out", "Geometric Morphing", "Time-lapse đám đông", "Panning kiến trúc"],
        camera: ["Static (Fixed)", "Slow Zoom In", "Slow Pan", "Macro", "Time-lapse", "Slow Motion", "Focus Pull", "Aerial Hover", "Underwater", "Microscope"],
        lighting: ["Soft Diffused", "Backlit", "Silhouette", "Bioluminescent", "Warm Glow", "Cool Blue", "Gradient", "Sparkling", "Shadow Play", "Volumetric Beams"]
    },
    cafe: {
        focus: ["Barista making coffee", "Steam rising from cup", "Rain on window", "Couple talking", "Person reading book", "Cat sleeping", "Latte art pouring", "Coffee beans grinding", "Cake display", "Empty chair"],
        tone: ["Cozy", "Lonely", "Busy", "Morning vibes", "Romantic", "Study/Work", "Rainy Day", "Vintage", "Modern/Clean", "Late Night"],
        setting: ["Window seat", "Bar counter", "Outdoor terrace", "Cozy corner with sofa", "Book shelf area", "Entrance door", "Kitchen view", "Street view", "Garden area", "Rooftop"],
        camera: ["Top-down (Flat lay)", "Through the window", "Over the shoulder", "Extreme Close-up", "Low angle from table", "Slider shot", "Rack focus", "Handheld", "Reflection", "POV"],
        lighting: ["Warm Tungsten", "Natural Window Light", "Dim/Moody", "Neon Sign", "Morning Sun", "Overcast/Soft", "Candlelight", "Fairy Lights", "Shadowy", "Bright & Airy"]
    },
    starbucks: {
        tone: ["Modern", "Cozy", "Product-Focused", "Morning Vibes", "Social", "Work/Study", "Artistic", "Clean", "Warm", "Urban"],
        setting: ["Starbucks Counter", "Starbucks Outdoor Seating", "Starbucks Window Seat", "Close-up Cup with Logo", "Barista pouring", "New Frappuccino", "Coffee Beans Display", "Merchandise Shelf", "Drive-thru", "Community Table"],
        action: ["Sipping coffee", "Working on laptop", "Laughing with friends", "Barista steaming milk", "Hand holding cup", "Steam rising", "Ice swirling", "Pouring syrup", "Reading book", "Walking in"],
        camera: ["Macro Product Shot", "Slow Pan", "Rack Focus on Logo", "Top-down Flatlay", "Handheld POV", "Dolly In", "Wide Shop Shot", "Through Window", "Low Angle", "Bokeh Background"],
        lighting: ["Natural Window Light", "Warm Tungsten", "Golden Hour", "Bright & Airy", "Soft Diffused", "Morning Sun", "Cozy Shadow", "Clean White", "Neon reflection", "Cinematic Warmth"]
    },
    concert: {
        tone: ["Intimate", "Explosive", "Emotional", "Worshipful", "Rockstar", "Acoustic", "Grand", "Raw", "Polished", "Atmospheric"],
        setting: ["Main Stage Center", "Runway/Catwalk", "Backstage", "Crowd View", "Drum Riser", "Piano Bench", "Microphone Stand", "Confetti Rain", "Smoke Machine", "Laser Show"],
        action: ["Singing with passion", "Playing guitar solo", "Drumming intense", "Crowd hands up", "Kneeling", "Jumping", "Interacting with fans", "Closing eyes", "Sweating", "Bowing"],
        camera: ["Handheld Shaky", "Crane/Jib", "Steadicam", "Zoom In", "Wide Crowd Shot", "Close-up Face", "Instrument Detail", "Low Angle Hero", "Behind the Artist", "Silhouette"],
        lighting: ["Spotlight", "Strobe", "Laser Beams", "Phone Flashlights", "Blue Wash", "Red Alert", "Silhouette Backlight", "Pulsing", "Blackout", "Golden Haze"]
    },
    stage: {
        tone: ["Grand", "Futuristic", "Minimalist", "Holy", "Cyberpunk", "Abstract", "Nature-inspired", "Industrial", "Dreamy", "Dramatic"],
        setting: ["LED Wall (Abstract)", "LED Wall (Nature)", "LED Wall (Jesus)", "LED Wall (Lyrics)", "Platform", "Stairs", "Center Stage", "Orchestra Pit", "Choir Stand", "Cross Structure"],
        action: ["Visuals morphing", "Lights sweeping", "Fog rolling", "Platform rising", "Colors changing", "Screen flickering", "Pyrotechnics", "Confetti blast", "Spotlight searching", "Darkness falling"],
        camera: ["Wide Master Shot", "Slow Pan", "Symmetrical", "Top Down", "Dolly In", "Dolly Out", "Tracking", "Dutch Angle", "Timelapse", "Zoom Out"],
        lighting: ["Beam Matrix", "Wash", "Spot", "Pixel Mapping", "Blinders", "UV/Blacklight", "Warm White", "Cool White", "RGB Cycle", "Gobo Patterns"]
    }
};

export const criticalRules = `
    \n**CRITICAL RULES FOR EACH PROMPT:**
    1.  **BE DECISIVE AND SPECIFIC:** NEVER give options (e.g., 'man or woman', 'forest or mountain'). You must choose ONE specific detail.
    2.  **INDEPENDENCE & REPETITION:** Treat every single prompt as if it's the only one. The AI has no memory of previous prompts. Therefore, you MUST re-describe the main subject in full detail in EVERY prompt. DO NOT use pronouns like 'he', 'she', 'that person'.
    3.  **DESCRIBE ACTIONS, NOT EMOTIONS:** Only describe what can be seen. Instead of 'a tear of relief', write 'a single tear rolls down his cheek'.
    4.  **LANGUAGE:** The entire 'prompt_text' key MUST be in English.`;

export const cinematicQualityRule = `5. **CINEMATIC QUALITY:** All prompts must describe a photorealistic scene with cinematic color grading, rich tones, and deep contrast. Use terms like 'volumetric lighting', 'lens flares', and 'soft focus' where appropriate to enhance the visual richness.
    [DOCUMENTARY REALISM]
    Use these keywords to enforce a realistic, non-stylized look where appropriate (e.g., for nature or biblical scenes): 
    "Ultra-Photorealistic 8K quality", "Filmed on ARRI ALEXA", "Natural available light", "Sharp focus", "Documentary aesthetic".
    [EXCLUSION]
    ABSOLUTELY NO digital painting, no heavy stylization, no fantasy effects, no surrealism, no unrealistic glowing elements. The output must look like high-quality, professional footage.`;
    
export const religiousGuardrails = `
    [MANDATORY RELIGIOUS & AESTHETIC GUARDRAILS]
    1. **ABSOLUTELY NO POP MUSIC ELEMENTS:** Forbidden items include neon lights, flashy modern outfits, backup dancers, overly stylized pop graphics, rapid MTV-style editing, or sexualized imagery.
    2. **TONE & ATMOSPHERE:** Must be solemn, reverent, cinematic, warm, and muted. Think "Sacred", "Holy", "Timeless".
    3. **COSTUME:** Characters must wear conservative, modest, timeless clothing (e.g., linen robes for biblical figures, simple dress/suit for modern worship leaders). No logos, no modern fashion trends.
    4. **SETTING:** Focus on grand cathedrals, ancient churches, nature (mountains, rivers), or humble biblical settings (carpenter shop, desert).
`;