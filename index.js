require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// Middleware to allow Frontend to talk to Backend
app.use(cors());
app.use(express.json());

// Database Connection Configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Supabase/Render connection
});

// --- API ROUTES ---

// Root Test Route
app.get('/', (req, res) => {
  res.send('Course Manager Backend is Live and Healthy!');
});

// 1. Get Active Courses (For the Course Dropdown)
app.get('/courses', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM courses WHERE status = 'Active'");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching courses" });
  }
});

// 2. Get Participants for a specific Course (For the Student Dropdown)
// *** THIS WAS THE MISSING PART ***
app.get('/courses/:id/participants', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM participants WHERE course_id = $1 ORDER BY full_name ASC", 
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching participants" });
  }
});

// 3. Check-In Participant (Updates the Database)
app.post('/check-in', async (req, res) => {
  const { 
    courseId, participantId, 
    roomNo, seatNo, laundryToken, 
    mobileLocker, valuablesLocker, language 
  } = req.body;
  
  try {
    // SQL Query to update the participant's logistics
    const query = `
      UPDATE participants 
      SET status = 'Arrived', 
          room_no = $1, 
          dining_seat_no = $2, 
          laundry_token_no = $3, 
          mobile_locker_no = $4, 
          valuables_locker_no = $5, 
          discourse_language = $6
      WHERE participant_id = $7 AND course_id = $8
      RETURNING *;
    `;
    
    const values = [
      roomNo, seatNo, laundryToken, 
      mobileLocker, valuablesLocker, language, 
      participantId, courseId
    ];
    
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Participant not found or Course ID mismatch" });
    }

    res.json(result.rows[0]);
    
  } catch (err) {
    console.error("Check-in Error:", err);
    
    // Handle "Unique Constraint" errors (Prevent Double Booking)
    if (err.code === '23505') { 
      // Check which constraint failed to give a specific error
      if (err.detail.includes('room_no')) {
        return res.status(409).json({ error: `Room ${roomNo} is already occupied.` });
      }
      if (err.detail.includes('dining_seat_no')) {
        return res.status(409).json({ error: `Seat ${seatNo} is already taken.` });
      }
      if (err.detail.includes('laundry_token_no')) {
        return res.status(409).json({ error: `Token ${laundryToken} is already assigned.` });
      }
      return res.status(409).json({ error: "Duplicate assignment detected." });
    } 
    
    res.status(500).json({ error: err.message });
  }
});

// Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
