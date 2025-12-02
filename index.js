require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const upload = multer({ dest: 'uploads/' });

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- HELPER: PROTECTED ROOMS ---
const PROTECTED_ROOMS = new Set([
  "301AI","301BI","302AI","302BI","303AI","303BI","304AI","304BI",
  "305AI","305BI","306AI","306BI","307AW","307BW","308AW","308BW",
  "309AW","309BW","310AW","310BW","311AW","311BW","312AW","312BW",
  "313AW","313BW","314AW","314BW","315AW","315BW","316AW","316BW"
]);

// --- API ROUTES ---

// 1. GET ALL COURSES
app.get('/api/courses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM courses ORDER BY start_date DESC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. CREATE COURSE
app.post('/api/courses', async (req, res) => {
  const { course_name, teacher_name, start_date, end_date } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO courses (course_name, teacher_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [course_name, teacher_name, start_date, end_date]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. GET PARTICIPANTS (By Course)
app.get('/api/participants', async (req, res) => {
  const { course_id } = req.query;
  try {
    const result = await pool.query(
      'SELECT * FROM participants WHERE course_id = $1 ORDER BY COALESCE(token_number, 9999), full_name', 
      [course_id]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. UPDATE PARTICIPANT (The "Lost Features" Fix)
// This strictly maps every single field from your DB schema so nothing is lost on edit.
app.put('/api/participants/:id', async (req, res) => {
  const { id } = req.params;
  const p = req.body;

  try {
    const query = `
      UPDATE participants SET
        full_name = $1, age = $2, gender = $3, status = $4,
        phone_number = $5, email = $6, room_no = $7,
        dining_seat_no = $8, dining_seat_type = $9,
        dhamma_hall_seat_no = $10, special_seating = $11,
        mobile_locker_no = $12, valuables_locker_no = $13,
        laundry_token_no = $14, pagoda_cell_no = $15,
        evening_food = $16, medical_info = $17, teacher_notes = $18,
        token_number = $19, process_stage = $20, discourse_language = $21,
        courses_info = $22
      WHERE participant_id = $23 RETURNING *
    `;
    
    const values = [
      p.full_name, p.age, p.gender, p.status,
      p.phone_number, p.email, p.room_no,
      p.dining_seat_no, p.dining_seat_type,
      p.dhamma_hall_seat_no, p.special_seating,
      p.mobile_locker_no, p.valuables_locker_no,
      p.laundry_token_no, p.pagoda_cell_no,
      p.evening_food, p.medical_info, p.teacher_notes,
      p.token_number, p.process_stage, p.discourse_language,
      p.courses_info,
      id
    ];

    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: err.message }); 
  }
});

// 5. BULK UPLOAD CSV (Matches your CSV headers)
app.post('/api/upload-csv', upload.single('file'), async (req, res) => {
  const { courseId } = req.body;
  const results = [];
  
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Delete existing for clean overwrite (Optional, based on your preference)
        await client.query('DELETE FROM participants WHERE course_id = $1', [courseId]);

        const insertText = `
          INSERT INTO participants (
            course_id, full_name, conf_no, age, gender, status, 
            phone_number, email, courses_info, 
            mobile_locker_no, valuables_locker_no, laundry_token_no,
            discourse_language, room_no, dining_seat_no, 
            dhamma_hall_seat_no, special_seating,
            evening_food, medical_info, teacher_notes,
            token_number, process_stage
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        `;

        for (const row of results) {
          // Parse CSV Logic - Handling missing fields gracefully
          await client.query(insertText, [
            courseId,
            row.full_name || row['Name'],
            row.conf_no || '',
            parseInt(row.age) || 0,
            row.gender || 'Male',
            row.status || 'No Response',
            row.phone_number || row['Phone'],
            row.email || '',
            row.courses_info || '',
            row.mobile_locker_no,
            row.valuables_locker_no,
            row.laundry_token_no,
            row.discourse_language,
            row.room_no,
            row.dining_seat_no,
            row.dhamma_hall_seat_no,
            row.special_seating,
            row.evening_food,
            row.medical_info,
            row.teacher_notes,
            row.token_number ? parseInt(row.token_number) : null,
            row.process_stage ? parseInt(row.process_stage) : 0
          ]);
        }
        await client.query('COMMIT');
        res.json({ message: 'Upload successful', count: results.length });
      } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
      } finally {
        client.release();
        fs.unlinkSync(req.file.path);
      }
    });
});

// 6. ASSIGN TOKEN (Zero Day Automation)
app.post('/api/assign-token', async (req, res) => {
    const { participant_id, course_id } = req.body;
    try {
        // Find next token number for this course
        const countRes = await pool.query('SELECT MAX(token_number) as max_tok FROM participants WHERE course_id = $1', [course_id]);
        const nextToken = (countRes.rows[0].max_tok || 0) + 1;

        const updateRes = await pool.query(
            'UPDATE participants SET token_number = $1, status = $2, process_stage = 1 WHERE participant_id = $3 RETURNING *',
            [nextToken, 'Arrived', participant_id]
        );
        res.json(updateRes.rows[0]);
    } catch(err) { res.status(500).json({error: err.message}); }
});

// 7. DASHBOARD STATS
app.get('/api/dashboard/:courseId', async (req, res) => {
    const { courseId } = req.params;
    try {
        const pRes = await pool.query('SELECT * FROM participants WHERE course_id = $1', [courseId]);
        const rRes = await pool.query('SELECT * FROM rooms');
        
        const participants = pRes.rows;
        const total = participants.length;
        const arrived = participants.filter(p => p.status === 'Arrived').length;
        const male = participants.filter(p => p.gender === 'Male').length;
        const female = participants.filter(p => p.gender === 'Female').length;
        
        res.json({ total, arrived, male, female });
    } catch(err) { res.status(500).json({error: err.message}); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
