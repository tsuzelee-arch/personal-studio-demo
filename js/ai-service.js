/**
 * ai-service.js — AI Vision API integration for image analysis
 * Supports OpenAI (GPT-4o) and Google Gemini (gemini-1.5-pro)
 */
window.AIService = (function() {

  const AI_DEBUG = localStorage.getItem('ps_debug') === '1';

  // Resize + compress a base64 dataUrl before sending to API.
  // Skips compression if image already fits within maxDim.
  // outputFormat: 'image/jpeg' for photos, 'image/png' for masks.
  function compressImage(dataUrl, maxDim = 1024, quality = 0.85, outputFormat = 'image/jpeg') {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width <= maxDim && height <= maxDim) { resolve(dataUrl); return; }
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL(outputFormat, quality));
        } catch (e) {
          console.error('compressImage canvas process failed, resolving with original dataUrl:', e);
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function resolveImageToDataUrl(img) {
    if (!img) return null;
    if (img.startsWith('data:')) return img;
    
    let target = img;
    if (!img.startsWith('blob:') && !img.startsWith('http:') && !img.startsWith('https:')) {
      if (window.AssetManager && typeof window.AssetManager.getFileBlobUrlByPath === 'function' && window.AssetManager.isConnected()) {
        try {
          const blobUrl = await window.AssetManager.getFileBlobUrlByPath(img);
          if (blobUrl) {
            target = blobUrl;
          }
        } catch (e) {
          console.error('[AI Service] AssetManager failed to resolve path:', img, e);
        }
      }
    }
    
    const r = await fetch(target);
    const blob = await r.blob();
    if (window.StudioUtils && typeof window.StudioUtils.fileToDataURL === 'function') {
      return await window.StudioUtils.fileToDataURL(blob);
    } else {
      return await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onloadend = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
    }
  }

  function fetchWithTimeout(url, opts = {}, timeoutMs = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

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

    const response = await fetchWithTimeout(url, {
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

    const res = await fetchWithTimeout(url, {
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
  // Unified single-prompt text generation across providers. Routes by model id
  // (OPENAI_MODELS → OpenAI chat-completions, otherwise Gemini generateContent),
  // applies the provider-specific request/response shape, and returns the raw
  // trimmed text. Options: { temperature, maxTokens, json }. For OpenAI, temperature
  // and JSON response_format are only sent to legacy gpt-4o (newer models reject them).
  async function generateText(prompt, apiKey, model, opts = {}) {
    const { temperature, maxTokens, json = false } = opts;
    const openaiModelId = OPENAI_MODELS[model];

    if (openaiModelId) {
      const isLegacy = openaiModelId === 'gpt-4o';
      const body = {
        model: openaiModelId,
        messages: [{ role: 'user', content: prompt }],
        ...(maxTokens && { max_completion_tokens: maxTokens }),
        ...(isLegacy && temperature != null && { temperature }),
        ...(isLegacy && json && { response_format: { type: 'json_object' } })
      };
      const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenAI API error (${res.status})`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content == null) throw new Error('Empty response from OpenAI');
      return content.trim();
    }

    const modelName = model === 'geminilite' ? 'gemini-2.5-flash-lite' : 'gemini-3.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const generationConfig = {};
    if (temperature != null) generationConfig.temperature = temperature;
    if (maxTokens) generationConfig.maxOutputTokens = maxTokens;
    if (json) generationConfig.response_mime_type = 'application/json';
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API error (${res.status})`);
    }
    const data = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (content == null) throw new Error('Empty response from Gemini');
    return content.trim();
  }

  async function rewriteToNaturalLanguage(structuredPrompt, apiKey, model, outputLanguage = '繁體中文') {
    const rewritePrompt = `You are an expert prompt engineer. Your task is to convert the following structured visual analysis prompt into a single, cohesive, beautifully flowing natural language paragraph.

CRITICAL INSTRUCTIONS:
- Combine all details (style, subject, environment, lighting, camera, materials) smoothly without using brackets or bullet points.
- Preserve all negative constraints at the very end of the prompt starting with "--no".
- You MUST write the descriptive paragraph in ${outputLanguage} language, BUT keep technical photography/lighting terms and parameter flags in English where appropriate.
- DO NOT output any introductory text, just the final natural language prompt.

Structured Prompt to Rewrite:
${structuredPrompt}`;

    return generateText(rewritePrompt, apiKey, model, { temperature: 0.5 });
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
      const res = await fetchWithTimeout(url, {
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
      const res = await fetchWithTimeout(url, {
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
    const response = await fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }, 15000);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    return true;
  }

  async function testGemini(apiKey) {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {}, 15000);
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    return true;
  }

  async function testGeminilite(apiKey) {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {}, 15000);
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    return true;
  }

  // Nano Banana Pro runs on the same Google Generative Language API as Gemini,
  // so a key validity check hits the same models endpoint.
  async function testNanobanana(apiKey) {
    const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {}, 15000);
    if (!res.ok) throw new Error(`Nano Banana HTTP ${res.status}`);
    return true;
  }


  // ── File to Base64 ──
  function fileToBase64(file) {
    return window.StudioUtils.fileToDataURL(file).then(dataUrl => ({
      base64: window.StudioUtils.dataUrlToBase64(dataUrl),
      mimeType: file.type || 'image/jpeg'
    }));
  }

  async function _executeGeminiRequest(url, payload, modelName) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') throw new Error(`${modelName} 請求逾時（90秒），伺服器無回應`);
      throw new Error('網路錯誤：' + fetchErr.message);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `${modelName} API Error: HTTP ${response.status}`);
    }

    const data = await response.json();
    const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!imagePart) {
      const textPart = data.candidates?.[0]?.content?.parts?.find(p => p.text);
      const errReason = textPart ? textPart.text : JSON.stringify(data);
      throw new Error(`${modelName} Error: ${errReason}`);
    }
    const { mime_type, data: b64 } = imagePart.inlineData;
    return `data:${mime_type || 'image/png'};base64,${b64}`;
  }

  // ── Image Generation APIs ──
  // Allowed values per the Gemini image-generation API (generationConfig.imageConfig
  // and thinkingConfig). Sending a value outside these sets makes the API reject the
  // request (HTTP 400) or silently ignore it, so we sanitize before building the body
  // to guarantee the parameters are actually accepted.
  const NB_ASPECT_RATIOS = ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','21:9','1:4','4:1','1:8','8:1'];
  const NB_IMAGE_SIZES = ['512','1K','2K','4K'];
  const NB_THINKING_LEVELS = ['minimal','high'];

  // Build a valid imageConfig, dropping anything unsupported (defaults to 1:1).
  function _buildImageConfig(aspectRatio, imageSize) {
    const cfg = { aspectRatio: NB_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1' };
    if (imageSize && NB_IMAGE_SIZES.includes(imageSize)) cfg.imageSize = imageSize;
    return cfg;
  }

  // Map UI thinking level to a valid API value, or null to omit thinkingConfig.
  // Accepts 'none' (disable), legacy 'low' (→ 'minimal'), or a valid level.
  function _resolveThinkingLevel(level) {
    if (level === 'low') level = 'minimal';
    return NB_THINKING_LEVELS.includes(level) ? level : null;
  }

  async function generateWithNanoBanana(prompt, apiKey, options = {}) {
    // Nano Banana Pro -> gemini-3-pro-image
    const {
      aspectRatio = '1:1',
      imageSize = '',
      temperature = null,
      thinkingLevel = 'none',
      googleSearch = false,
    } = options;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${apiKey}`;

    const generationConfig = {
      imageConfig: _buildImageConfig(aspectRatio, imageSize),
      responseModalities: googleSearch ? ['TEXT', 'IMAGE'] : ['IMAGE']
    };
    if (temperature != null) generationConfig.temperature = temperature;
    const _tlPro = _resolveThinkingLevel(thinkingLevel);
    if (_tlPro) generationConfig.thinkingConfig = { thinkingLevel: _tlPro };

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
      tools: googleSearch ? [{ google_search: {} }] : undefined,
    };

    return await _executeGeminiRequest(url, payload, 'Nano Banana Pro');
  }

  async function generateWithNanoBanana2(prompt, apiKey, images = null, mask = null, options = {}) {
    // Nano Banana 2 -> gemini-3.1-flash-image (supports img2img + mask + advanced params)
    const {
      aspectRatio = '1:1',
      imageSize = '',
      temperature = 0.4,
      topP = 0.95,
      maxOutputTokens = 65536,
      stopSequences = [],
      thinkingLevel = 'none',
      googleSearch = false,
    } = options;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${apiKey}`;

    const stripPrefix = (dataUrl) => dataUrl ? dataUrl.replace(/^data:[^;]+;base64,/, '') : null;

    // Calculate width/height from imageSize and aspectRatio for the magic string
    let baseDim = 1024;
    if (imageSize === '512') baseDim = 512;
    else if (imageSize === '2K') baseDim = 2048;
    else if (imageSize === '4K') baseDim = 4096;
    else if (imageSize === '1K') baseDim = 1024;

    let w = baseDim, h = baseDim;
    if (aspectRatio && aspectRatio.includes(':')) {
      const partsArr = aspectRatio.split(':');
      const rW = parseFloat(partsArr[0]);
      const rH = parseFloat(partsArr[1]);
      if (!isNaN(rW) && !isNaN(rH) && rH > 0) {
        if (rW > rH) {
          h = Math.round(baseDim * (rH / rW));
        } else {
          w = Math.round(baseDim * (rW / rH));
        }
      }
    }

    const sizedPrompt = `[${w}x${h}] ${prompt}`;
    let resolvedMask = null;
    if (mask) {
      try {
        resolvedMask = await resolveImageToDataUrl(mask);
      } catch (e) {
        console.error('Failed to resolve mask URL/path to base64 dataUrl:', mask, e);
      }
    }
    const compressedMask = resolvedMask ? await compressImage(resolvedMask, 1024, 1.0, 'image/png') : null;
    const parts = [{ text: sizedPrompt }];
    const imageArray = Array.isArray(images) ? images : (images ? [images] : []);
    for (const img of imageArray) {
      let resolved = null;
      try {
        resolved = await resolveImageToDataUrl(img);
      } catch (e) {
        console.error('Failed to resolve image URL/path to base64 dataUrl:', img, e);
      }
      const compressed = resolved ? await compressImage(resolved, 1024, 0.85, 'image/jpeg') : null;
      if (compressed) {
        const mimeMatch = compressed.match(/^data:([^;]+);/);
        parts.push({ inline_data: { mime_type: mimeMatch?.[1] || 'image/jpeg', data: stripPrefix(compressed) } });
      }
    }
    if (compressedMask) {
      const mimeMask = compressedMask.match(/^data:([^;]+);/);
      parts.push({ inline_data: { mime_type: mimeMask ? mimeMask[1] : 'image/png', data: stripPrefix(compressedMask) } });
    }

    const generationConfig = {
      temperature,
      topP,
      maxOutputTokens,
      stopSequences: stopSequences.length ? stopSequences : undefined,
      imageConfig: _buildImageConfig(aspectRatio, imageSize),
      responseModalities: googleSearch ? ['TEXT', 'IMAGE'] : ['IMAGE']
    };
    const _tl2 = _resolveThinkingLevel(thinkingLevel);
    if (_tl2) generationConfig.thinkingConfig = { thinkingLevel: _tl2 };

    const payload = {
      contents: [{ parts }],
      generationConfig,
      tools: googleSearch ? [{ google_search: {} }] : undefined,
    };

    return await _executeGeminiRequest(url, payload, 'Nano Banana 2');
  }

  async function generateWithGPTImage(prompt, apiKey, size="1024x1024", baseImage=null, options={}) {
    // baseImage may be a single dataURL string or an array of dataURLs (multiple
    // reference images). Normalize to an array so all references are sent.
    const refImages = Array.isArray(baseImage)
      ? baseImage.filter(Boolean)
      : (baseImage ? [baseImage] : []);

    // Resolve all references to base64 data URLs
    const resolvedRefs = [];
    for (const ref of refImages) {
      try {
        const resolved = await resolveImageToDataUrl(ref);
        if (resolved) resolvedRefs.push(resolved);
      } catch (e) {
        console.error('[GPT Image 2] Failed to resolve reference image:', ref, e);
      }
    }

    let resolvedMask = null;
    if (options.mask) {
      try {
        resolvedMask = await resolveImageToDataUrl(options.mask);
      } catch (e) {
        console.error('[GPT Image 2] Failed to resolve mask image:', options.mask, e);
      }
    }

    const isEdit = resolvedRefs.length > 0 || !!resolvedMask;
    const url = isEdit ? 'https://api.openai.com/v1/images/edits' : 'https://api.openai.com/v1/images/generations';
    
    let body;
    let headers = {
      'Authorization': `Bearer ${apiKey}`
    };

    const quality = options.quality || "high";
    let background = options.background || "auto";
    if (background === "transparent") background = "auto";

    if (isEdit) {
      const formData = new FormData();
      formData.append('model', 'gpt-image-2');
      formData.append('prompt', prompt);
      formData.append('n', '1');
      formData.append('size', size);
      formData.append('quality', quality);
      formData.append('background', 'auto');
      formData.append('output_format', 'webp');
      formData.append('output_compression', '80');
      formData.append('moderation', 'auto');

      // The base image: use the first item in resolvedRefs. Convert to PNG.
      const baseImg = resolvedRefs[0];
      if (baseImg) {
        const pngDataUrl = await compressImage(baseImg, 1024, 1.0, 'image/png');
        const baseRes = await fetch(pngDataUrl);
        const baseBlob = await baseRes.blob();
        formData.append('image', baseBlob, 'image.png');
      }

      // The mask image: use resolvedMask if available. Convert to PNG.
      if (resolvedMask) {
        const maskPngDataUrl = await compressImage(resolvedMask, 1024, 1.0, 'image/png');
        const maskRes = await fetch(maskPngDataUrl);
        const maskBlob = await maskRes.blob();
        formData.append('mask', maskBlob, 'mask.png');
      }
      body = formData;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        model: "gpt-image-2",
        prompt: prompt,
        n: 1,
        size: size,
        quality: quality,
        background: background,
        output_format: "webp",
        output_compression: 80,
        moderation: "auto"
      });
    }

    if (AI_DEBUG) console.log('[GPT Image 2] Request to:', url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body,
        signal: controller.signal
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') throw new Error('GPT Image 2 請求逾時（90秒），請重試');
      throw new Error('網路錯誤：' + fetchErr.message);
    } finally {
      clearTimeout(timeout);
    }

    if (AI_DEBUG) console.log('[GPT Image 2] HTTP status:', response.status);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[GPT Image 2] API error:', err);
      throw new Error(err.error?.message || `GPT Image 2 API Error: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (AI_DEBUG) console.log('[GPT Image 2] Response keys:', Object.keys(data));
    const b64 = data.data?.[0]?.b64_json;
    if (b64) {
      return `data:image/png;base64,${b64}`;
    }
    const urlResult = data.data?.[0]?.url;
    if (urlResult) {
      return urlResult;
    }
    throw new Error("No image data returned from GPT Image 2");
  }

  // ── Unified API key resolution ──
  // Centralises "which model needs which key" so UI controllers don't need to know.
  function resolveApiKey(model) {
    if (!window.StudioSettings) return null;
    if (model.startsWith('openai')) return window.StudioSettings.getOpenAIKey();
    if (model === 'geminilite') return window.StudioSettings.getGeminiliteKey();
    return window.StudioSettings.getGeminiKey();
  }

  // ── Unified analysis entry point ──
  // UI controllers can call `AIService.analyze(file, model, lang)` without
  // worrying about key resolution or model-specific dispatch.
  async function analyze(file, model, lang) {
    const key = resolveApiKey(model);
    if (!key) throw new Error('API Key 未設定');
    const { base64, mimeType } = await fileToBase64(file);
    if (model.startsWith('openai')) {
      return analyzeWithOpenAI(base64, key, mimeType, lang, model);
    }
    if (model === 'geminilite') {
      return analyzeWithGeminilite(base64, key, mimeType, lang);
    }
    return analyzeWithGemini(base64, key, mimeType, 'gemini-3.5-flash', lang);
  }

  // ── Chrome Built-in Gemini Nano (Prompt API) ──
  async function checkNanoAvailability() {
    const aiNamespace = window.ai || (window.model && window.model.ai);
    if (!aiNamespace) {
      return { available: false, status: 'no', reason: 'not-supported' };
    }

    const languageModel = aiNamespace.languageModel || aiNamespace.assistant;
    if (!languageModel) {
      return { available: false, status: 'no', reason: 'api-missing' };
    }

    try {
      const capabilities = await languageModel.capabilities();
      const status = capabilities.available; // 'readily', 'after-download', or 'no'
      return {
        available: status === 'readily' || status === 'after-download',
        status: status,
        capabilities
      };
    } catch (e) {
      if (typeof languageModel.create === 'function') {
        return { available: true, status: 'readily', reason: 'legacy-support' };
      }
      return { available: false, status: 'no', reason: 'error', error: e.message };
    }
  }

  async function generateTextNano(prompt, systemPrompt = '') {
    const aiNamespace = window.ai || (window.model && window.model.ai);
    if (!aiNamespace) {
      throw new Error("您的瀏覽器不支援本機 Gemini Nano (Window AI) 接口。");
    }

    const languageModel = aiNamespace.languageModel || aiNamespace.assistant;
    if (!languageModel) {
      throw new Error("本機語言模型 API 遺失，請至 chrome://flags 開記相關設定。");
    }

    let session;
    try {
      const options = {
        temperature: 0.4,
        topK: 3
      };
      if (systemPrompt) {
        options.systemPrompt = systemPrompt;
      }
      session = await languageModel.create(options);
      
      let result = await session.prompt(prompt);
      if (result) {
        result = result.trim();
        // 清理本地模型有時會返回的 Markdown 程式碼區塊標記
        if (result.startsWith('```')) {
          result = result.replace(/^```[a-zA-Z]*\s*\n/, '').replace(/\n\s*```$/, '');
        }
      }
      return result;
    } catch (e) {
      throw new Error(`執行本機模型失敗：${e.message}\n(請確認模型是否已完全下載至您的設備中)`);
    } finally {
      if (session && typeof session.destroy === 'function') {
        session.destroy();
      }
    }
  }

  // ── Replicate / fal.ai Cloud API Routing (Support local proxy & Git direct fallback) ──
  
  function isLocalBackend() {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  async function generateWithReplicate(prompt, apiKey, modelVersion, inputParams = {}, corsProxy = '') {
    throw new Error('Replicate 雲端 API 目前在測試中，已暫時禁用。');
    const isLocal = isLocalBackend();
    let url = isLocal ? '/api/ai/replicate/predictions' : 'https://api.replicate.com/v1/predictions';
    if (!isLocal) {
      if (corsProxy) {
        url = corsProxy.trim().replace(/\/+$/, '') + '/' + url;
      } else {
        throw new Error('Replicate 在靜態部署下需要設定 CORS 代理位址（請前往「設定」配置）');
      }
    }

    const payload = {
      version: modelVersion,
      input: { prompt, ...inputParams }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Replicate 發起失敗：${err}`);
    }

    const data = await res.json();
    let predictionId = data.id;

    // 輪詢狀態
    let statusUrl = isLocal ? `/api/ai/replicate/predictions/${predictionId}` : `https://api.replicate.com/v1/predictions/${predictionId}`;
    if (!isLocal && corsProxy) {
      statusUrl = corsProxy.trim().replace(/\/+$/, '') + '/' + statusUrl;
    }

    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(statusUrl, {
        headers: { 'Authorization': `Token ${apiKey}` }
      });
      if (!statusRes.ok) continue;
      const pred = await statusRes.json();
      if (pred.status === 'succeeded') {
        return Array.isArray(pred.output) ? pred.output[0] : pred.output;
      }
      if (pred.status === 'failed' || pred.status === 'canceled') {
        throw new Error(`Replicate 執行失敗：${pred.error || '被取消'}`);
      }
    }
    throw new Error('Replicate 執行超時');
  }

  async function generateWithFal(prompt, apiKey, modelId, inputParams = {}) {
    throw new Error('fal.ai 雲端 API 目前在測試中，已暫時禁用。');
    const url = `https://queue.fal.run/${modelId}`;
    
    const submitRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${apiKey}`
      },
      body: JSON.stringify({ prompt, ...inputParams })
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      throw new Error(`fal.ai 發起失敗：${err}`);
    }

    const { request_id } = await submitRes.json();
    const statusUrl = `https://queue.fal.run/${modelId}/requests/${request_id}`;

    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(statusUrl, {
        headers: { 'Authorization': `Key ${apiKey}` }
      });
      if (!statusRes.ok) continue;
      const task = await statusRes.json();
      if (task.status === 'COMPLETED') {
        return task.response.images[0].url;
      }
      if (task.status === 'FAILED') {
        throw new Error('fal.ai 執行失敗');
      }
    }
    throw new Error('fal.ai 輪詢超時');
  }

  async function testReplicate(apiKey) {
    const isLocal = isLocalBackend();
    let url = isLocal ? '/api/ai/replicate/predictions' : 'https://api.replicate.com/v1/predictions';
    const corsProxy = window.StudioSettings?.getReplicateCorsProxy?.() || '';
    if (!isLocal && corsProxy) {
      url = corsProxy.trim().replace(/\/+$/, '') + '/' + url;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiKey}`
      },
      body: JSON.stringify({
        version: 'black-forest-labs/flux-schnell',
        input: { prompt: 'test' }
      })
    });
    if (res.status === 401) {
      throw new Error('金鑰無效');
    }
    return true;
  }

  async function testFal(apiKey) {
    const res = await fetch('https://queue.fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${apiKey}`
      },
      body: JSON.stringify({ prompt: 'test' })
    });
    if (res.status === 401) {
      throw new Error('金鑰無效');
    }
    return true;
  }

  // ── OpenAI Batch API ──
  // Build JSONL blob from requests, upload as a file, then create the batch job.
  // requests: [{ customId, messages, model, maxTokens }]
  async function submitOpenAIBatch(requests, apiKey) {
    // Each request: { customId, endpoint, body }
    // endpoint defaults to '/v1/images/generations' for image nodes;
    // can also be '/v1/chat/completions', '/v1/images/edits', etc.
    const lines = requests.map(r => JSON.stringify({
      custom_id: r.customId,
      method: 'POST',
      url: r.endpoint || '/v1/images/generations',
      body: r.body
    }));
    const jsonlText = lines.join('\n');
    const encoder = new TextEncoder();
    const jsonlUint8 = encoder.encode(jsonlText);
    const jsonlBlob = new Blob([jsonlUint8], { type: 'application/jsonl; charset=utf-8' });
    const jsonlFile = new File([jsonlBlob], 'batch_input.jsonl', { type: 'application/jsonl' });
    const formData = new FormData();
    formData.append('purpose', 'batch');
    formData.append('file', jsonlFile);

    const uploadRes = await fetchWithTimeout('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    }, 30000);
    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI file upload error (${uploadRes.status})`);
    }
    const fileData = await uploadRes.json();
    const inputFileId = fileData.id;

    // Determine the common endpoint for the batch job header
    // (if mixed endpoints, use a sensible default; in practice callers should group by endpoint)
    const batchEndpoint = requests[0]?.endpoint || '/v1/images/generations';

    const batchRes = await fetchWithTimeout('https://api.openai.com/v1/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ input_file_id: inputFileId, endpoint: batchEndpoint, completion_window: '24h' })
    }, 15000);
    if (!batchRes.ok) {
      const err = await batchRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI batch create error (${batchRes.status})`);
    }
    const batchData = await batchRes.json();
    return { batchId: batchData.id, inputFileId, status: batchData.status };
  }

  async function getOpenAIBatchStatus(batchId, apiKey) {
    const res = await fetchWithTimeout(`https://api.openai.com/v1/batches/${batchId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }, 15000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI batch status error (${res.status})`);
    }
    const data = await res.json();
    return {
      status: data.status,
      outputFileId: data.output_file_id || null,
      errorFileId: data.error_file_id || null,
      requestCounts: data.request_counts || {}
    };
  }

  async function getOpenAIBatchResults(outputFileId, apiKey) {
    const res = await fetchWithTimeout(`https://api.openai.com/v1/files/${outputFileId}/content`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }, 60000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI file download error (${res.status})`);
    }
    const text = await res.text();
    const resultMap = new Map();
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const item = JSON.parse(line);
        const body = item.response?.body;
        // Image generation response: data[].b64_json
        const b64 = body?.data?.[0]?.b64_json ?? null;
        const urlResult = body?.data?.[0]?.url ?? null;
        const imageUrl = b64 ? `data:image/webp;base64,${b64}` : urlResult;
        // Text chat completion response: choices[].message.content
        const content = body?.choices?.[0]?.message?.content ?? null;
        const error = item.error?.message ?? null;
        resultMap.set(item.custom_id, { imageUrl, content, error });
      } catch { /* skip malformed lines */ }
    }
    return resultMap;
  }

  async function cancelOpenAIBatch(batchId, apiKey) {
    const res = await fetchWithTimeout(`https://api.openai.com/v1/batches/${batchId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }, 15000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI batch cancel error (${res.status})`);
    }
    return true;
  }


  // ── Gemini AI Studio Batch (parallel, uses existing API key) ──
  // Runs all image generation requests in parallel via generativelanguage.googleapis.com.
  // No GCP project, Service Account, or GCS needed — just the AI Studio API key.
  async function submitGeminiBatch(requests, apiKey) {
    const resultMap = new Map();
    await Promise.all(requests.map(async (r) => {
      try {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + r.model + ':generateContent?key=' + apiKey;
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: r.contents, generationConfig: r.generationConfig })
        }, 120000);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          resultMap.set(r.customId, { error: err.error?.message || 'Gemini error ' + res.status });
          return;
        }
        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
        if (!imgPart) {
          resultMap.set(r.customId, { error: '無圖像輸出（模型可能未回傳圖片）' });
          return;
        }
        const { mimeType, data: b64 } = imgPart.inlineData;
        resultMap.set(r.customId, { imageUrl: 'data:' + mimeType + ';base64,' + b64 });
      } catch (e) {
        resultMap.set(r.customId, { error: e.message });
      }
    }));
    return resultMap;
  }


  // ── Public API ──
  return {
    analyzeWithOpenAI,
    analyzeWithGemini,
    analyzeWithGeminilite,
    translateAnalysis,
    rewriteToNaturalLanguage,
    generateText,
    generateWithNanoBanana,
    generateWithNanoBanana2,
    generateWithGPTImage,
    generateWithReplicate,
    generateWithFal,
    testOpenAI,
    testGemini,
    testGeminilite,
    testNanobanana,
    testReplicate,
    testFal,
    fileToBase64,
    resolveApiKey,
    analyze,
    compressImage,
    resolveImageToDataUrl,
    SYSTEM_PROMPT,
    checkNanoAvailability,
    generateTextNano,
    submitOpenAIBatch,
    getOpenAIBatchStatus,
    getOpenAIBatchResults,
    cancelOpenAIBatch,
    submitGeminiBatch
  };

})();
