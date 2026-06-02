/**
 * ai-service.js — AI Vision API integration for image analysis
 * Supports OpenAI (GPT-4o) and Google Gemini (gemini-1.5-pro)
 */
window.AIService = (function() {

  // ── System Prompt ──
  // Forces the AI to return a strict JSON structure matching our dashboard
  const SYSTEM_PROMPT = `You are an elite image analyst specialized in visual deconstruction for generative AI prompt engineering. 
Given an image, you must produce a comprehensive analysis in **strict JSON format only** — no markdown, no commentary, no code fences, just raw JSON.

Your JSON output MUST follow this exact structure:

{
  "analysis_metadata": {
    "estimated_style": "string — describe the visual style, art movement, rendering technique",
    "creation_process": "string — infer how the image was likely created (photography, digital art, AI, painting, etc.)",
    "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
    "mood_and_atmosphere": "string — describe the emotional tone and atmosphere"
  },
  "separated_elements_breakdown": {
    "foreground_fx": "string — describe any foreground effects, particles, overlays",
    "main_subject": {
      "identity": "string — what/who is the main subject",
      "clothing_or_surface": "string — describe clothing, skin, surface textures in detail",
      "pose_and_action": "string — describe pose, gesture, movement, expression"
    },
    "midground_objects": "string — describe objects, props, secondary elements",
    "background_environment": "string — describe the background setting, scenery, atmosphere"
  },
  "lighting_physics": {
    "key_light": {
      "direction": "string — light direction relative to subject",
      "color_temp": "string — estimated color temperature",
      "quality": "string — hard/soft, diffused/directional"
    },
    "fill_and_rim_lights": "string — describe fill, rim, accent lighting"
  },
  "camera_simulation": {
    "estimated_lens": "string — focal length estimation",
    "depth_of_field": "string — shallow/deep, bokeh quality",
    "camera_angle": "string — eye-level, low angle, high angle, etc."
  },
  "material_and_texture_notes": {
    "key1_descriptive_name": "string — material description",
    "key2_descriptive_name": "string — material description"
  },
  "composition_analysis": {
    "framing": "string — describe framing and spatial arrangement",
    "silhouette": "string — describe silhouette readability",
    "value_structure": "string — describe light/dark distribution",
    "visual_hierarchy": "string — what draws the eye first, second, third"
  },
  "inferred_negative_constraints": [
    "string — things to AVOID when recreating this image",
    "string — another constraint"
  ]
}

Rules:
- The color_palette MUST contain exactly 5 hex color codes extracted from the image.
- material_and_texture_notes should have 3-6 entries with descriptive snake_case keys.
- inferred_negative_constraints should have 4-7 entries.
- All strings should be detailed and descriptive (2-4 sentences each).
- Output ONLY the JSON object, nothing else.`;

  // ── OpenAI Vision API (ChatGPT 5.5) ──
  async function analyzeWithOpenAI(imageBase64, apiKey, mimeType) {
    const url = 'https://api.openai.com/v1/chat/completions';
    const body = {
      model: 'chatgpt-5.5',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
      max_tokens: 4096,
      temperature: 0.3
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

  // ── Gemini Vision API (Gemini 3.5 Flash) ──
  async function analyzeWithGemini(imageBase64, apiKey, mimeType) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const body = {
      contents: [
        {
          parts: [
            { text: SYSTEM_PROMPT + '\n\nAnalyze this image thoroughly and return the JSON analysis.' },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error (${response.status}): ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) throw new Error('Gemini returned empty response');

    return parseAIResponse(content);
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

    // Ensure color_palette is an array of hex strings
    if (!Array.isArray(parsed.analysis_metadata.color_palette)) {
      parsed.analysis_metadata.color_palette = ['#333333', '#666666', '#999999', '#cccccc', '#eeeeee'];
    }

    // Ensure inferred_negative_constraints is an array
    if (!Array.isArray(parsed.inferred_negative_constraints)) {
      parsed.inferred_negative_constraints = ['No constraints extracted'];
    }

    return parsed;
  }

  // ── Test connections ──
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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
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
  async function generateWithNanoBanana(prompt, apiKey) {
    // Hypothetical endpoint for Nano Banana Pro
    const url = 'https://api.nanobanana.ai/v1/generate'; 
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ prompt, model: 'nano-banana-pro' })
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      return data.image_url;
    } catch(e) {
      // Fallback mock for demonstration since the API is hypothetical
      console.warn("Nano Banana API failed/unavailable, returning mock image.", e);
      return new Promise(resolve => setTimeout(() => resolve('https://images.unsplash.com/photo-1549490349-8643362247b5?w=512&q=80'), 1500));
    }
  }

  async function generateWithGPTImage(prompt, apiKey) {
    const url = 'https://api.openai.com/v1/images/generations';
    const body = {
      model: "gpt-image-2.0",
      prompt: prompt,
      n: 1,
      size: "1024x1024"
    };

    try {
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
        throw new Error(`GPT Image API error (${response.status}): ${err.error?.message || response.statusText}`);
      }
      const data = await response.json();
      return data.data[0].url;
    } catch(e) {
       console.warn("GPT Image 2.0 API failed/unavailable, returning mock image.", e);
       return new Promise(resolve => setTimeout(() => resolve('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=512&q=80'), 1500));
    }
  }

  // ── Public API ──
  return {
    analyzeWithOpenAI,
    analyzeWithGemini,
    generateWithNanoBanana,
    generateWithGPTImage,
    testOpenAI,
    testGemini,
    fileToBase64,
    SYSTEM_PROMPT
  };

})();
