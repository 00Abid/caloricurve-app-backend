import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.length || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
};

app.use(cors(corsOptions));
app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const modelName = 'gemini-2.0-flash-exp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Helpers to handle AI responses that include code fences or extra text
function stripCodeFences(text) {
  if (!text) return '';
  return String(text)
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '')
    .trim();
}

function safeParseJsonArrayFromText(text) {
  const cleaned = stripCodeFences(text);
  // Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  // Try extracting first [ ... ] block
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = cleaned.substring(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function safeParseJsonObjectFromText(text) {
  const cleaned = stripCodeFences(text);
  // Try direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}
  // Try extracting first { ... } block
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = cleaned.substring(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return null;
}

function parseAmountUnit(text) {
  if (!text) return { grams: null, unit: null, amount: null, baseText: text };
  const regex = /(\d+(?:\.\d+)?)\s*(g|gram|grams|kg|ml|mL|milliliter|milliliters|l|L)/i;
  const match = text.match(regex);
  if (!match) return { grams: null, unit: null, amount: null, baseText: text };
  const amount = parseFloat(match[1]);
  const unitRaw = match[2];
  const unit = unitRaw.toLowerCase();
  let grams = null;
  if (unit === 'g' || unit === 'gram' || unit === 'grams') {
    grams = amount;
  } else if (unit === 'kg') {
    grams = amount * 1000;
  } else if (unit === 'ml' || unit === 'mL' || unit === 'milliliter' || unit === 'milliliters') {
    grams = amount; // assume 1 g/ml when density unknown
  } else if (unit === 'l' || unit === 'L') {
    grams = amount * 1000;
  }
  const baseText = text.replace(regex, '').trim();
  return { grams, unit, amount, baseText };
}

function extractGramsFromPortion(portion) {
  if (!portion) return null;
  const match = portion.match(/\((\d+(?:\.\d+)?)\s*(g|ml)\)/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  return unit === 'ml' ? val : val; // assume 1 g/ml when density unknown
}

function scaleNutrients(item, scale) {
  const numericKeys = [
    'calories','protein','fat','carbs','fiber','sugar','sodium','iron','zinc','calcium','vitaminB12','vitaminD','vitaminA','omega3','vitaminC','magnesium','potassium'
  ];
  const scaled = { ...item };
  numericKeys.forEach(k => {
    if (typeof scaled[k] === 'number' && !Number.isNaN(scaled[k])) {
      scaled[k] = +(scaled[k] * scale).toFixed(2);
    }
  });
  return scaled;
}

function filterFallback(queryText) {
  const data = getFallbackData();
  if (!queryText) return [];
  const q = queryText.toLowerCase();
  return data.filter(item => String(item.name || '').toLowerCase().includes(q)).slice(0, 6);
}

function buildResultsFromFallback(items, desiredGrams, unit, amount, query) {
  let normalized = items.map(item => ({
    name: String(item.name || query),
    portion: String(item.portion || '1 serving (100g)'),
    calories: Number(item.calories || 0),
    protein: Number(item.protein || 0),
    carbs: Number(item.carbs || 0),
    fat: Number(item.fat || 0),
    fiber: Number(item.fiber || 0),
    sugar: Number(item.sugar || 0),
    sodium: Number(item.sodium || 0),
    iron: Number(item.iron || 0),
    zinc: Number(item.zinc || 0),
    calcium: Number(item.calcium || 0),
    vitaminB12: Number(item.vitaminB12 || 0),
    vitaminD: Number(item.vitaminD || 0),
    vitaminA: Number(item.vitaminA || 0),
    omega3: Number(item.omega3 || 0),
    vitaminC: Number(item.vitaminC || 0),
    magnesium: Number(item.magnesium || 0),
    potassium: Number(item.potassium || 0),
  }));

  if (desiredGrams && normalized.length) {
    normalized = normalized.map(it => {
      const portionGrams = extractGramsFromPortion(it.portion);
      if (portionGrams && portionGrams > 0) {
        const scale = desiredGrams / portionGrams;
        const scaled = scaleNutrients(it, scale);
        const labelUnit = unit && (unit.toLowerCase().includes('l') || unit.toLowerCase().includes('ml')) ? 'ml' : 'g';
        scaled.portion = `custom serving (${amount}${labelUnit})`;
        return scaled;
      }
      const scale = desiredGrams / 100;
      const scaled = scaleNutrients(it, scale);
      const labelUnit = unit && (unit.toLowerCase().includes('l') || unit.toLowerCase().includes('ml')) ? 'ml' : 'g';
      scaled.portion = `custom serving (${amount}${labelUnit})`;
      return scaled;
    });
  }
  return normalized;
}



app.get('/api/foods', async (req, res) => {
  const query = String(req.query.query || '').trim();
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  // If AI is not configured, return error
  if (!genAI) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const { grams: desiredGrams, unit, amount, baseText } = parseAmountUnit(query);
    const prompt = `You are a nutrition assistant. For the food: "${baseText || query}", return a concise JSON array of up to 3 plausible matches with complete nutrition per standard portion.
Return ONLY valid JSON, no markdown, no explanations.
Each item must have these fields:
- name (string)
- portion (string, include grams in parentheses like "1 serving (100g)")
- calories (number)
- protein (number, grams)
- carbs (number, grams)
- fat (number, grams)
- fiber (number, grams)
- sugar (number, grams)
- sodium (number, mg)
- iron (number, mg)
- zinc (number, mg)
- calcium (number, mg)
- vitaminB12 (number, µg)
- vitaminD (number, µg)
- vitaminA (number, µg)
- omega3 (number, grams)
- vitaminC (number, mg)
- magnesium (number, mg)
- potassium (number, mg)`;

    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || '';
    const data = safeParseJsonArrayFromText(text);
    if (!data) {
      console.error('Invalid AI foods JSON (could not parse array):', text);
      return res.status(502).json({ error: 'Invalid AI response format' });
    }

    // Basic sanitization: ensure required fields and types
    let normalized = data
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        name: String(item.name || query),
        portion: String(item.portion || '1 serving (100g)'),
        calories: Number(item.calories || 0),
        protein: Number(item.protein || 0),
        carbs: Number(item.carbs || 0),
        fat: Number(item.fat || 0),
        fiber: Number(item.fiber || 0),
        sugar: Number(item.sugar || 0),
        sodium: Number(item.sodium || 0),
        iron: Number(item.iron || 0),
        zinc: Number(item.zinc || 0),
        calcium: Number(item.calcium || 0),
        vitaminB12: Number(item.vitaminB12 || 0),
        vitaminD: Number(item.vitaminD || 0),
        vitaminA: Number(item.vitaminA || 0),
        omega3: Number(item.omega3 || 0),
        vitaminC: Number(item.vitaminC || 0),
        magnesium: Number(item.magnesium || 0),
        potassium: Number(item.potassium || 0),
      }));

    // Scale nutrients when an amount was specified in the query
    if (desiredGrams && normalized.length) {
      normalized = normalized.map(item => {
        const portionGrams = extractGramsFromPortion(item.portion);
        if (portionGrams && portionGrams > 0) {
          const scale = desiredGrams / portionGrams;
          const scaled = scaleNutrients(item, scale);
          const labelUnit = unit && (unit.toLowerCase().includes('l') || unit.toLowerCase().includes('ml')) ? 'ml' : 'g';
          scaled.portion = `custom serving (${amount}${labelUnit})`;
          return scaled;
        }
        // Fallback assumption if portion grams not provided: scale per 100g
        const scale = desiredGrams / 100;
        const scaled = scaleNutrients(item, scale);
        const labelUnit = unit && (unit.toLowerCase().includes('l') || unit.toLowerCase().includes('ml')) ? 'ml' : 'g';
        scaled.portion = `custom serving (${amount}${labelUnit})`;
        return scaled;
      });
    }

    res.json({ results: normalized });
  } catch (err) {
    console.error('Gemini lookup failed:', err);
    return res.status(502).json({ error: 'Gemini foods request failed' });
  }
});

// Removed rule-based fallback suggestions per request

// AI suggestions endpoint
app.post('/api/suggestions', async (req, res) => {
  const { totalNutrients, dailyGoals, meals } = req.body || {};
  if (!totalNutrients || !dailyGoals) {
    return res.status(400).json({ error: 'Missing totalNutrients or dailyGoals' });
  }

  // If Gemini not configured, return error
  if (!genAI) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const summary = JSON.stringify({ totalNutrients, dailyGoals, meals: Array.isArray(meals) ? meals.slice(0, 10) : undefined });
    const prompt = `You are a nutrition assistant. Based on the user's logged food (meals if provided), their total intake and daily goals, provide an ordered list of up to 6 concise, actionable suggestions to improve nutrient balance today.
Return ONLY valid JSON in this exact shape:
{"suggestions": ["<tip>", "<tip>"]}
Guidelines:
- Use short, specific, food-based actions (e.g., "Add 1 cup Greek yogurt for protein").
- Prioritize the largest deficiencies first; also warn if sugar/sodium are excessive.
- Consider realistic Indian foods when relevant.
Data:
${summary}`;

    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || '';
    const parsed = safeParseJsonObjectFromText(text);
    if (!parsed || !Array.isArray(parsed.suggestions)) {
      return res.status(502).json({ error: 'AI response missing suggestions array' });
    }

    const suggestions = parsed.suggestions
      .map(s => String(s))
      .filter(s => s && s.trim())
      .slice(0, 6);
    return res.json({ suggestions });
  } catch (err) {
    console.error('Gemini suggestions failed:', err);
    return res.status(502).json({ error: 'Gemini suggestions request failed' });
  }
});

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

// Basic root route for readiness and quick check
app.get('/', (req, res) => {
  res.status(200).send('CalorieCurve API OK');
});

// Health check route for deployment platforms
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.listen(PORT, HOST, () => {
  console.log(`CalorieCurve server listening on http://${HOST}:${PORT}`);
});