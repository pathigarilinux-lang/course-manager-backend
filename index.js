require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const PROTECTED_ROOMS = new Set(["301AI","301BI","302AI","302BI","DF1","DF2","DF3"]); // (Keep your full list here)

app.get('/', (req, res) => res.send('Backend Live'));

// --- AUTOMATION: ARRIVAL & TOKEN GENERATION (STEP 1) ---
app.post('/process/arrival', async (req, res) => {
  const { participantId, courseId } = req.body;
  try {
    // 1. Get the current highest token for this course
    const maxTokenRes = await pool.query("SELECT MAX(token_number) as max_token FROM participants WHERE course_id = $1", [courseId]);
    const nextToken = (maxTokenRes.rows[0].max_token || 0) + 1;

    // 2. Assign Token and Move to Stage 1
    const result = await pool.query(
      "UPDATE participants SET token_number = $1, process_stage = 1, status = 'In Process' WHERE participant_id = $2 RETURNING *",
      [nextToken, participantId]
    );
    
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- AUTOMATION: UPDATE STAGE (STEP 2 & 3) ---
app.post('/process/update-stage', async (req, res) => {
  const { participantId, stage } = req.body; // stage: 2 (Briefing), 3 (Interview)
  try {
    const result = await pool.query(
      "UPDATE participants SET process_stage = $1 WHERE participant_id = $2 RETURNING *",
      [stage, participantId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- EXISTING ENDPOINTS (Keep these exactly as they were) ---
// (Paste your previous existing endpoints here: /rooms, /check-in, /participants etc.)
// ...
// ... (For brevity in this chat, assume standard CRUD endpoints exist below)
// ...

// RE-ADD THIS ONE SPECIFICALLY FOR ONBOARDING (STEP 4)
app.post('/check-in', async (req, res) => {
  const { courseId, participantId, roomNo, seatNo, diningSeatType, laundryToken, mobileLocker, valuablesLocker, language, pagodaCell, laptop, confNo, dhammaSeat, specialSeating } = req.body;
  try {
    // 1. CHECK IF ELIGIBLE (Must be Stage 3 to Onboard)
    const check = await pool.query("SELECT process_stage FROM participants WHERE participant_id = $1", [participantId]);
    if (check.rows[0].process_stage < 3) {
        return res.status(400).json({ error: "⛔ Student has not completed Teacher Interview (Step 3) yet." });
    }

    const clean = (val) => (val && typeof val === 'string' && ['na', 'n/a', 'no', 'none', '-'].includes(val.trim().toLowerCase())) ? null : (val || null);
    
    // ... (Room conflict logic here) ...
    
    const query = `
      UPDATE participants 
      SET status = 'Arrived', process_stage = 4, room_no = $1, dining_seat_no = $2, laundry_token_no = $3, 
          mobile_locker_no = $4, valuables_locker_no = $5, discourse_language = $6,
          pagoda_cell_no = $7, laptop_details = $8, conf_no = $9, dhamma_hall_seat_no = $10,
          special_seating = $11, dining_seat_type = $12
      WHERE participant_id = $13 AND course_id = $14
      RETURNING *;
    `;
    const values = [ clean(roomNo), clean(seatNo), clean(laundryToken), clean(mobileLocker), clean(valuablesLocker), language||'English', clean(pagodaCell), laptop, clean(confNo), clean(dhammaSeat), clean(specialSeating), diningSeatType, participantId, courseId ];
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// ... (End of file)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
