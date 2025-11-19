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

app.get('/', (req, res) => res.send('Backend is Live!'));

// 1. Get Active Courses
app.get('/courses', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM courses WHERE status = 'Active'");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json(err.message);
  }
});

// 2. Check-In Participant
app.post('/check-in', async (req, res) => {
  const { courseId, participantId, roomNo, seatNo, laundryToken, ...others } = req.body;

  try {
    const query = `
      UPDATE participants 
      SET status = 'Arrived', room_no = $1, dining_seat_no = $2, laundry_token_no = $3, 
          mobile_locker_no = $4, valuables_locker_no = $5, discourse_language = $6
      WHERE participant_id = $7 AND course_id = $8
      RETURNING *;
    `;
    const values = [roomNo, seatNo, laundryToken, others.mobileLocker, others.valuablesLocker, others.language, participantId, courseId];

    const result = await pool.query(query, values);
    res.json(result.rows[0]);

  } catch (err) {
    if (err.code === '23505') { 
      res.status(409).json({ error: "Duplicate: Room, Seat, or Token already taken." });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
