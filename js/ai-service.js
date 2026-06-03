/**
 * ai-service.js — AI Vision API integration for image analysis
 * Supports OpenAI (GPT-4o) and Google Gemini (gemini-1.5-pro)
 */
window.AIService = (function() {

  const OPENAI_MODELS = {
    'openai':        'gpt-5.5',
    'openai-54':     'gpt-5.4',
    'openai-54mini': 'gpt-5.4-mini',
    'openai-4o':     'gpt-4o'
  };  // ── System Prompt (Visual Decompiler) ──
  const SYSTEM_PROMPT = `# Role & Objective
Your task is to act as a "Visual Decompiler."
Analyze the user-provided image and reverse-engineer its visual components into a strict, highly detailed JSON structure. You must dissect the image into separated elements (foreground, subject, lighting, background) and estimate the physical rendering parameters.

# Analysis Guidelines
1. Define image: analyze the main motif of image, define the emphasis and secondary, the processing Dimensional Decoupling.
2. Dimensional Decoupling: Do not describe the image as a single flat scene. Deconstruct it into distinct spatial layers.
3. Emotion & Color Resonance: CRITICAL - In every visual description (especially for style, mood, and elements), you MUST include an analysis of the emotional feeling/vibe and how the color palette contributes to that emotion.
4. Parameterization: Estimate realistic values for lighting intensity, color temperatures (in Kelvin), and camera settings (lens focal length, aperture).
5. Material & Texture: Closely inspect the surfaces of objects to describe their micro-details (e.g., "matte porous leather", "high-gloss subsurface scattering").
6. Drawing/Photography Style: Define the exact type and process of drawing style or photography. if multiple element detected, describe them all, analysis how the image design/created/drawn.
7. Negative Space: Deduce what elements are intentionally omitted or kept clean to form the "negative_constraints".
8. Be HONEST, Do not guess and Perfunctory: if there is no element detected (etc: no subject/people detected in image), just be honest and left null. do not fill reluctantly.

# Output Constraints
- You MUST output strictly valid JSON, and absolutely nothing else.
- Do NOT wrap the output in markdown code blocks (\`\`\`json). Just return the raw JSON object.
- NO conversational filler. NO introductory or concluding remarks.

# Expected JSON Schema
{
  "analysis_metadata": {
    "creative_theme": "[The overarching theme, genre, or core concept of the image, including emotional resonance]",
    "estimated_style": "[e.g., Cinematic Photography, 3D Render, Anime Concept Art, with Drawing/Photography process and how colors affect the style]",
    "color_palette": ["[Hex code 1]", "[Hex code 2]", "... up to 8 most distinct key colors only; avoid near-duplicate shades"],
    "mood_and_atmosphere": "[1-2 sentences describing the overall vibe, specific emotions conveyed, and how lighting/colors build this feeling]"
  },
  "separated_elements_breakdown": {
    "foreground_fx": "[Identify elements closest to the camera, e.g., dust particles, out-of-focus leaves, lens flares. If none, write 'null']",
    "main_subject": {
      "identity": "[Who or what is it? Include emotional expression if applicable]",
      "character_source": "[If recognized, character's name and franchise/source origin. If not, write 'Original Character' or 'null']",
      "clothing_or_surface": "[Detailed description of the subject's outer layer, noting color and texture feelings]",
      "pose_and_action": "[Specific posture and directional gaze, and the emotion it conveys]"
    },
    "midground_objects": "[Props or elements interacting with the subject]",
    "background_environment": "[The setting, depth, and specific background structures, noting the atmospheric mood]",
    "main_visual_composition": "[Describe the composition rules used, e.g., Rule of Thirds, Symmetry, Golden Ratio, Framing, Leading Lines, and visual flow]",
    "other_elements": "[Any notable elements not captured above: overlays, text, UI, particles, abstract devices. If none, write 'null']"
  },
  "lighting_physics": {
    "key_light": {
      "direction": "[e.g., Top-left, 45 degrees]",
      "color_temp": "[e.g., Warm 3200K]",
      "quality": "[Hard shadows or soft diffuse]"
    },
    "fill_and_rim_lights": "[Identify secondary light sources, edge lighting, or bounced light]"
  },
  "camera_simulation": {
    "estimated_lens": "[e.g., 24mm Wide Angle, 85mm Portrait]",
    "depth_of_field": "[e.g., Shallow (f/1.8) with heavy bokeh, or Deep focus]",
    "camera_angle": "[e.g., Low-angle hero shot, Eye-level, Top-down]"
  },
  "image_dimensions_and_resolution": "[Estimate the aspect ratio (e.g., 16:9, 1:1) and describe the perceived resolution or detail quality]",
  "material_and_texture_notes": {
    "[key_descriptive_name]": "[material description]",
    "[key_descriptive_name2]": "[material description]"
  },
  "inferred_negative_constraints": [
    "[Identify 3-5 visual flaws or elements intentionally kept out of this image to maintain its quality]"
  ]
}`;

  // ── OpenAI Vision API ──
  async function analyzeWithOpenAI(imageBase64, apiKey, mimeType, outputLanguage = '繁體中文', dropdownModel = 'openai') {
    const dynamicPrompt = SYSTEM_PROMPT + `\n\nCRITICAL INSTRUCTION: You MUST output all descriptive text values (except JSON keys and structure) in ${outputLanguage} language.`;
    const modelId = OPENAI_MODELS[dropdownModel] || 'gpt-5.5';
    const isLegacy = modelId === 'gpt-4o';
    const url = 'https://api.openai.com/v1/chat/completions';
    const body = {
      model: modelId,
      messages: [
        { role: 'system', content: dynamicPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image thoroughly and return the JSON analysis.' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_completion_tokens: 4096,
      ...(isLegacy && { temperature: 0.3, response_format: { type: "json_object" } })
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error (${response.status}): ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty response');

    return parseAIResponse(content);
  }

  // ── Google Gemini API ──
  async function analyzeWithGemini(imageBase64, apiKey, mimeType, modelName = 'gemini-3.5-flash', outputLanguage = '繁體中文') {
    const dynamicPrompt = SYSTEM_PROMPT + `\n\nCRITICAL INSTRUCTION: You MUST output all descriptive text values (except JSON keys and structure) in ${outputLanguage} language.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: dynamicPrompt },
          { inline_data: { mime_type: mimeType, data: imageBase64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        response_mime_type: "application/json"
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Gemini API Error: ${res.status}`);
    }

    const data = await res.json();
    let textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textOutput) throw new Error('Invalid response format from Gemini');

    return parseAIResponse(textOutput);
  }

  // ── Gemini 2.5 Lite API ──
  async function analyzeWithGeminilite(imageBase64, apiKey, mimeType, outputLanguage = '繁體中文') {
    return analyzeWithGemini(imageBase64, apiKey, mimeType, 'gemini-2.5-flash-lite', outputLanguage);
  }

  // ── Natural Language Rewriter ──
  async function rewriteToNaturalLanguage(structuredPrompt, apiKey, model, outputLanguage = '繁體中文') {
    const rewritePrompt = `You are an expert prompt engineer. Your task is to convert the following structured visual analysis prompt into a single, cohesive, beautifully flowing natural language paragraph.

CRITICAL INSTRUCTIONS:
- Combine all details (style, subject, environment, lighting, camera, materials) smoothly without using brackets or bullet points.
- Preserve all negative constraints at the very end of the prompt starting with "--no".
- You MUST write the descriptive paragraph in ${outputLanguage} language, BUT keep technical photography/lighting terms and parameter flags in English where appropriate.
- DO NOT output any introductory text, just the final natural language prompt.

Structured Prompt to Rewrite:
${structuredPrompt}`;

    const openaiModelId = OPENAI_MODELS[model];
    if (openaiModelId) {
      const url = 'https://api.openai.com/v1/chat/completions';
      const body = {
        model: openaiModelId,
        messages: [{ role: 'user', content: rewritePrompt }],
        ...(openaiModelId === 'gpt-4o' && { temperature: 0.5 })
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Rewrite API Error');
      const data = await res.json();
      return data.choices[0].message.content.trim();
    } else {
      // Use Gemini for gemini and geminilite
      const modelName = model === 'geminilite' ? 'gemini-2.5-flash-lite' : 'gemini-3.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ role: "user", parts: [{ text: rewritePrompt }] }],
        generationConfig: { temperature: 0.5 }
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Rewrite API Error');
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text.trim() || '';
    }
  }

  // ── Translate existing analysis JSON into a new language ──
  async function translateAnalysis(analysis, targetLanguage, apiKey, model) {
    const prompt = `You are a professional translator. Translate all human-readable text values inside the following JSON into ${targetLanguage}.

CRITICAL RULES:
- Keep the JSON structure EXACTLY as-is (same keys, same nesting, same array structure).
- Only translate descriptive string values. DO NOT translate: JSON keys, null values, hex color codes (e.g. #FF5733), purely numeric strings, or the string "null".
- Return ONLY raw valid JSON — no markdown, no code fences, no commentary.

JSON to translate:
${JSON.stringify(analysis)}`;

    const openaiModelId = OPENAI_MODELS[model];
    if (openaiModelId) {
      const isLegacy = openaiModelId === 'gpt-4o';
      const url = 'https://api.openai.com/v1/chat/completions';
      const body = {
        model: openaiModelId,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 16384,
        ...(isLegacy && { temperature: 0.1, response_format: { type: 'json_object' } })
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Translation API error (${res.status})`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty translation response');
      return parseAIResponse(content);
    } else {
      const modelName = model === 'geminilite' ? 'gemini-2.5-flash-lite' : 'gemini-3.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, response_mime_type: 'application/json', maxOutputTokens: 8192 }
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Translation API error (${res.status})`);
      }
      const data = await res.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) throw new Error('Empty translation response');
      return parseAIResponse(content);
    }
  }

  // ── Parse AI response ──
  function parseAIResponse(raw) {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('AI returned invalid JSON. Please try again.\n\nRaw response:\n' + raw.substring(0, 500));
    }

    // Validate essential structure
    if (!parsed.analysis_metadata) throw new Error('Missing analysis_metadata in AI response');
    if (!parsed.separated_elements_breakdown) throw new Error('Missing separated_elements_breakdown in AI response');

    // Ensure new fields exist gracefully for older cache compat
    if (!parsed.analysis_metadata.creative_theme) parsed.analysis_metadata.creative_theme = null;
    if (parsed.separated_elements_breakdown.main_subject && !parsed.separated_elements_breakdown.main_subject.character_source) {
      parsed.separated_elements_breakdown.main_subject.character_source = null;
    }
    if (!parsed.separated_elements_breakdown.main_visual_composition) parsed.separated_elements_breakdown.main_visual_composition = null;
    if (!parsed.image_dimensions_and_resolution) parsed.image_dimensions_and_resolution = null;

    // Ensure color_palette is an array of strings
    if (!Array.isArray(parsed.analysis_metadata.color_palette)) {
      parsed.analysis_metadata.color_palette = ['#333333', '#666666', '#999999'];
    }

    // Ensure material_and_texture_notes exists
    if (!parsed.material_and_texture_notes) {
       parsed.material_and_texture_notes = {};
    }

    // Ensure inferred_negative_constraints is an array
    if (!Array.isArray(parsed.inferred_negative_constraints)) {
      parsed.inferred_negative_constraints = ['No constraints extracted'];
    }

    // Ensure other_elements exists (older AI responses may omit it)
    if (!parsed.separated_elements_breakdown.other_elements) {
      parsed.separated_elements_breakdown.other_elements = null;
    }

    return parsed;
  }

  // ── Testing Functions ──
  async function testOpenAI(apiKey) {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    return true;
  }

  async function testGemini(apiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    return true;
  }
  
  async function testGeminilite(apiKey) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    return true;
  }


  // ── File to Base64 ──
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // result is "data:<mime>;base64,<data>"
        const base64 = reader.result.split(',')[1];
        resolve({ base64, mimeType: file.type || 'image/jpeg' });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Image Generation APIs ──
  async function generateWithNanoBanana(prompt, apiKey, width=1024, height=1024) {
    // Hypothetical endpoint for Nano Banana Pro
    const url = 'https://api.nanobanana.ai/v1/generate'; 
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ prompt, model: 'nano-banana-pro', width, height })
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      return data.image_url;
    } catch(e) {
      // Fallback mock for demonstration since the API is hypothetical
      console.warn("Nano Banana API failed/unavailable, returning mock image.", e);
      return new Promise(resolve => setTimeout(() => resolve(`https://images.unsplash.com/photo-1549490349-8643362247b5?w=${width}&q=80`), 1500));
    }
  }

  async function generateWithNanoBanana2(prompt, apiKey, width=1024, height=1024, image=null, mask=null, cfg=7) {
    // Hypothetical endpoint for Nano Banana 2 (supports i2i)
    const url = 'https://api.nanobanana.ai/v2/generate'; 
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ prompt, model: 'nano-banana-2', width, height, image, mask, cfg })
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      return data.image_url;
    } catch(e) {
      console.warn("Nano Banana 2 API failed/unavailable, returning mock image.", e);
      return new Promise(resolve => setTimeout(() => resolve(`https://images.unsplash.com/photo-1549490349-8643362247b5?w=${width}&q=80`), 1500));
    }
  }

  async function generateWithGPTImage(prompt, apiKey, width=1024, height=1024) {
    const url = 'https://api.openai.com/v1/images/generations';
    const body = {
      model: "gpt-image-2",
      prompt: prompt,
      n: 1,
      size: `${width}x${height}`,
      quality: "low"
    };

    console.log('[GPT Image 2] Request body:', JSON.stringify(body));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') throw new Error('GPT Image 2 請求逾時（90秒），請重試');
      throw new Error('網路錯誤：' + fetchErr.message);
    } finally {
      clearTimeout(timeout);
    }

    console.log('[GPT Image 2] HTTP status:', response.status);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[GPT Image 2] API error:', err);
      throw new Error(err.error?.message || `GPT Image 2 API Error: HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('[GPT Image 2] Response keys:', Object.keys(data));
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("No image data returned from GPT Image 2");
    return `data:image/png;base64,${b64}`;
  }

  // ── Public API ──
  return {
    analyzeWithOpenAI,
    analyzeWithGemini,
    analyzeWithGeminilite,
    translateAnalysis,
    rewriteToNaturalLanguage,
    generateWithNanoBanana,
    generateWithNanoBanana2,
    generateWithGPTImage,
    testOpenAI,
    testGemini,
    testGeminilite,
    fileToBase64,
    SYSTEM_PROMPT
  };

})();
