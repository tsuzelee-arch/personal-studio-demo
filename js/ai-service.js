/**
 * ai-service.js — AI Vision API integration for image analysis
 * Supports OpenAI (GPT-4o) and Google Gemini (gemini-1.5-pro)
 */
window.AIService = (function() {

  // ── System Prompt (Visual Decompiler) ──
  const SYSTEM_PROMPT = `# Role & Objective 
Your task is to act as a "Visual Decompiler." 
Analyze the user-provided image and reverse-engineer its visual components into a strict, highly detailed JSON structure. You must dissect the image into separated elements (foreground, subject, lighting, background) and estimate the physical rendering parameters.

# Analysis Guidelines
1. Dimensional Decoupling: Do not describe the image as a single flat scene. Deconstruct it into distinct spatial layers.
2. Parameterization: Estimate realistic values for lighting intensity, color temperatures (in Kelvin), and camera settings (lens focal length, aperture).
3. Material & Texture: Closely inspect the surfaces of objects to describe their micro-details (e.g., "matte porous leather", "high-gloss subsurface scattering").
4. Drawing Style/Photography style: Define the exact type and process of drawing style or photography. analysis how the image design/created/drawn.
5. Negative Space: Deduce what elements are intentionally omitted or kept clean to form the "negative_constraints".

# Output Constraints
- You must output ONLY valid, parsable JSON.
- Do not wrap the JSON in markdown code blocks if the system strictly requires raw JSON payload. (Otherwise, use standard json formatting).
- No conversational filler. No introductory or concluding remarks.

# Expected JSON Schema
{
  "analysis_metadata": {
    "estimated_style": "[e.g., Cinematic Photography, 3D Render, Anime Concept Art, with Drawing/Photography process]",
    "color_palette": ["[Hex code 1]", "[Hex code 2]", "[Hex code 3]", "[Hex code 4]", "[Hex code 5]"],
    "mood_and_atmosphere": "[1-2 sentences describing the overall vibe]"
  },
  "separated_elements_breakdown": {
    "foreground_fx": "[Identify elements closest to the camera, e.g., dust particles, out-of-focus leaves, lens flares. If none, write 'null']",
    "main_subject": {
      "identity": "[Who or what is it?]",
      "clothing_or_surface": "[Detailed description of the subject's outer layer]",
      "pose_and_action": "[Specific posture and directional gaze]"
    },
    "midground_objects": "[Props or elements interacting with the subject]",
    "background_environment": "[The setting, depth, and specific background structures]"
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
  "material_and_texture_notes": {
    "[key_descriptive_name]": "[material description]",
    "[key_descriptive_name2]": "[material description]"
  },
  "inferred_negative_constraints": [
    "[Identify 3-5 visual flaws or elements intentionally kept out of this image to maintain its quality]"
  ]
}`;

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

  // ── Google Gemini API ──
  async function analyzeWithGemini(imageBase64, apiKey, mimeType, modelName = 'gemini-3.5-flash') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: SYSTEM_PROMPT },
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

  // ── Groq API ──
  async function analyzeWithGroq(imageBase64, apiKey, mimeType) {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const payload = {
      model: "llama-3.2-11b-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: SYSTEM_PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` }
            }
          ]
        }
      ],
      temperature: 0.2
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Groq API Error: ${res.status}`);
    }

    const data = await res.json();
    let content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Invalid response format from Groq');

    return parseAIResponse(content);
  }

  // ── Gemini 2.5 Lite API ──
  async function analyzeWithGeminilite(imageBase64, apiKey, mimeType) {
    return analyzeWithGemini(imageBase64, apiKey, mimeType, 'gemini-2.5-flash-lite');
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

  async function testGroq(apiKey) {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
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
    analyzeWithGeminilite,
    analyzeWithGroq,
    generateWithNanoBanana,
    generateWithGPTImage,
    testOpenAI,
    testGemini,
    testGeminilite,
    testGroq,
    fileToBase64,
    SYSTEM_PROMPT
  };

})();
