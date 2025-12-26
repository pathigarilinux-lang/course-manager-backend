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

// --- ROOMS ENDPOINTS ---
app.get('/rooms', async (req, res) => { 
  try { 
    const result = await pool.query("SELECT * FROM rooms ORDER BY room_no ASC"); 
    res.json(result.rows); 
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); } 
});

app.get('/rooms/occupancy', async (req, res) => { 
  try { 
    const query = `SELECT p.room_no, p.full_name, p.conf_no, p.status, p.gender, c.course_name, p.participant_id, p.course_id FROM participants p JOIN courses c ON p.course_id = c.course_id WHERE p.room_no IS NOT NULL AND p.room_no != ''`; 
    const result = await pool.query(query); 
    res.json(result.rows); 
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); } 
});

app.post('/rooms', async (req, res) => { 
  const { roomNo, type } = req.body; 
  try { 
    const result = await pool.query("INSERT INTO rooms (room_no, gender_type) VALUES ($1, $2) RETURNING *", [roomNo, type]); 
    res.json(result.rows[0]); 
  } catch (err) { if (err.code === '23505') return res.status(409).json({ error: "Room already exists" }); res.status(500).json({ error: err.message }); } 
});

app.delete('/rooms/:id', async (req, res) => { try { await pool.query("DELETE FROM rooms WHERE room_id = $1", [req.params.id]); res.json({ message: "Room deleted" }); } catch (err) { res.status(500).json({ error: err.message }); } });

// --- CHECK-IN (ONBOARDING) ---
app.post('/check-in', async (req, res) => {
    const { participantId, roomNo, seatNo, diningSeatType, laundryToken, mobileLocker, valuablesLocker, language, pagodaCell, laptop, confNo, dhammaSeat, specialSeating } = req.body;
    try {
        const clean = (val) => (val && typeof val === 'string' && ['na', 'n/a', 'no', 'none', '-'].includes(val.trim().toLowerCase())) ? null : (val || null);
        
        if (roomNo) { 
            const roomCheck = await pool.query("SELECT p.full_name FROM participants p WHERE p.room_no = $1 AND p.status = 'Attending' AND p.participant_id != $2", [roomNo, participantId]); 
            if (roomCheck.rows.length > 0) return res.status(409).json({ error: `Room occupied by ${roomCheck.rows[0].full_name}` }); 
        }

        const query = `UPDATE participants SET status = 'Attending', process_stage = 4, room_no = $1, dining_seat_no = $2, laundry_token_no = $3, mobile_locker_no = $4, valuables_locker_no = $5, discourse_language = $6, pagoda_cell_no = $7, laptop_details = $8, conf_no = $9, dhamma_hall_seat_no = $10, special_seating = $11, dining_seat_type = $12 WHERE participant_id = $13 RETURNING *;`;
        const values = [ clean(roomNo), clean(seatNo), clean(laundryToken), clean(mobileLocker), clean(valuablesLocker), language||'English', clean(pagodaCell), laptop, clean(confNo), clean(dhammaSeat), clean(specialSeating), diningSeatType, participantId ];
        
        const result = await pool.query(query, values);
        res.json(result.rows[0]);
    } catch (err) { console.error("Check-in Error:", err); res.status(500).json({ error: err.message }); }
});

// --- GATE ACTIONS ---
app.post('/gate-checkin', async (req, res) => {
    const { participantId } = req.body;
    try {
        const result = await pool.query("UPDATE participants SET status = 'Gate Check-In' WHERE participant_id = $1 RETURNING *", [participantId]);
        if (result.rows.length === 0) return res.status(400).json({ error: "Student not found." });
        res.json(result.rows[0]);
    } catch (err) { console.error("Gate Check-in Error:", err); res.status(500).json({ error: err.message }); }
});

app.post('/gate-cancel', async (req, res) => {
    const { participantId } = req.body;
    try {
        const result = await pool.query("UPDATE participants SET status = 'Cancelled' WHERE participant_id = $1 AND status != 'Attending' RETURNING *", [participantId]);
        if (result.rows.length === 0) return res.status(400).json({ error: "Cannot cancel attending student or student not found." });
        res.json(result.rows[0]);
    } catch (err) { console.error("Gate Cancel Error:", err); res.status(500).json({ error: err.message }); }
});

// --- PARTICIPANTS CRUD ---
app.put('/participants/:id', async (req, res) => { const { id } = req.params; const { full_name, phone_number, status, room_no, dining_seat_no, dining_seat_type, pagoda_cell_no, conf_no, dhamma_hall_seat_no, special_seating, discourse_language, evening_food, medical_info, teacher_notes, process_stage, token_number, is_seat_locked, mobile_locker_no, valuables_locker_no, laundry_token_no } = req.body; try { const clean = (val) => (val && ['na','n/a','none'].includes(val.toLowerCase())) ? null : (val || null); const result = await pool.query( `UPDATE participants SET full_name=$1, phone_number=$2, status=$3, room_no=$4, dining_seat_no=$5, pagoda_cell_no=$6, conf_no=$7, dhamma_hall_seat_no=$8, special_seating=$9, discourse_language=$10, dining_seat_type=$11, evening_food=$12, medical_info=$13, teacher_notes=$14, process_stage=$15, token_number=$16, is_seat_locked=$17, mobile_locker_no=$19, valuables_locker_no=$20, laundry_token_no=$21 WHERE participant_id=$18 RETURNING *`, [full_name, phone_number, status, clean(room_no), clean(dining_seat_no), clean(pagoda_cell_no), clean(conf_no), clean(dhamma_hall_seat_no), clean(special_seating), discourse_language, dining_seat_type, evening_food, medical_info, teacher_notes, process_stage, token_number, is_seat_locked || false, id, clean(mobile_locker_no), clean(valuables_locker_no), clean(laundry_token_no)] ); res.json(result.rows[0]); } catch (err) { res.status(500).json({ error: err.message }); } });

// --- COURSES & STATS ---
// ✅ REPLACEMENT ENDPOINT in backend/index.js
// Fixes "Arrived" count to include students currently at the Gate
app.get('/courses', async (req, res) => { 
  try { 
    const query = `
      SELECT 
        c.*, 
        -- "Arrived" now counts BOTH 'Attending' AND 'Gate Check-In'
        COUNT(CASE WHEN p.status IN ('Attending', 'Gate Check-In') THEN 1 END)::int as arrived,
        
        -- We keep 'gate' separate just in case you want to see who is waiting at the gate
        COUNT(CASE WHEN p.status = 'Gate Check-In' THEN 1 END)::int as gate,
        
        COUNT(CASE WHEN p.status = 'No Response' OR p.status = 'Pending' THEN 1 END)::int as pending,
        COUNT(CASE WHEN p.status = 'Cancelled' THEN 1 END)::int as cancelled 
      FROM courses c 
      LEFT JOIN participants p ON c.course_id = p.course_id 
      GROUP BY c.course_id 
      ORDER BY c.start_date DESC
    `; 
    const result = await pool.query(query); 
    res.json(result.rows); 
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  } 
});

app.post('/courses', async (req, res) => { 
    const { courseName, teacherName, startDate, endDate } = req.body; 
    try { 
        const result = await pool.query("INSERT INTO courses (course_name, teacher_name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *", [courseName, teacherName, startDate, endDate]); 
        res.json(result.rows[0]); 
    } catch (err) { res.status(500).json({ error: err.message }); } 
});

// ✅ NEW: UPDATE COURSE (Fixes Error 404)
app.put('/courses/:id', async (req, res) => {
    const { id } = req.params;
    const { courseName, teacherName, startDate, endDate } = req.body;
    try {
        const result = await pool.query(
            "UPDATE courses SET course_name=$1, teacher_name=$2, start_date=$3, end_date=$4 WHERE course_id=$5 RETURNING *",
            [courseName, teacherName, startDate, endDate, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Course not found" });
        res.json({ message: "Course updated successfully", course: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- DASHBOARD STATS LOGIC ---
app.get('/courses/:id/stats', async (req, res) => { 
  try { 
    const result = await pool.query("SELECT status, conf_no, gender FROM participants WHERE course_id = $1", [req.params.id]); 
    const stats = { 
        attending: 0, gate_checkin: 0, no_response: 0, cancelled: 0, 
        om: 0, of: 0, nm: 0, nf: 0, sm: 0, sf: 0, 
        attending_m: 0, attending_f: 0, gate_m: 0, gate_f: 0, pending_m: 0, pending_f: 0, 
        languages: [] 
    }; 
    result.rows.forEach(p => { 
        const isMale = p.gender && p.gender.toLowerCase() === 'male'; 
        if (p.status === 'Attending' || p.status === 'Arrived') { 
            stats.attending++; if(isMale) stats.attending_m++; else stats.attending_f++; 
            if (p.conf_no) { const code = p.conf_no.trim().toUpperCase(); if (code.startsWith('O')) stats.om++; else if (code.startsWith('N')) stats.nm++; else if (code.startsWith('S')) stats.sm++; }
        } else if (p.status === 'Gate Check-In') { stats.gate_checkin++; if(isMale) stats.gate_m++; else stats.gate_f++; 
        } else if (p.status === 'No Response') { stats.no_response++; if(isMale) stats.pending_m++; else stats.pending_f++; 
        } else if (p.status === 'Cancelled') { stats.cancelled++; } 
    }); 
    const langResult = await pool.query("SELECT discourse_language, COUNT(*) as total, COUNT(CASE WHEN LOWER(gender) = 'male' THEN 1 END)::int as male_count, COUNT(CASE WHEN LOWER(gender) = 'female' THEN 1 END)::int as female_count FROM participants WHERE course_id = $1 AND status = 'Attending' GROUP BY discourse_language ORDER BY total DESC", [req.params.id]); 
    stats.languages = langResult.rows; 
    res.json(stats); 
  } catch (err) { res.status(500).json({ error: err.message }); } 
});

app.get('/courses/:id/participants', async (req, res) => { try { const result = await pool.query("SELECT * FROM participants WHERE course_id = $1 ORDER BY full_name ASC", [req.params.id]); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/participants', async (req, res) => { const { courseId, fullName, coursesInfo, email, age, gender, confNo } = req.body; try { const check = await pool.query("SELECT participant_id FROM participants WHERE course_id = $1 AND LOWER(full_name) = LOWER($2)", [courseId, fullName]); if (check.rows.length > 0) return res.status(409).json({ error: "Student already exists." }); await pool.query("INSERT INTO participants (course_id, full_name, courses_info, email, age, gender, conf_no, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'No Response')", [courseId, fullName, coursesInfo, email, age, gender, confNo]); res.json({ message: "Student added" }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/courses/:id/import', async (req, res) => { const { id } = req.params; const { students } = req.body; if (!students || !Array.isArray(students)) return res.status(400).json({ error: "Invalid data" }); let added = 0, skipped = 0; try { for (const s of students) { const name = s.name ? s.name.trim() : ""; if (name.length < 1) continue; const check = await pool.query("SELECT participant_id FROM participants WHERE course_id = $1 AND (LOWER(full_name) = LOWER($2) OR (conf_no IS NOT NULL AND conf_no = $3))", [id, name, s.confNo]); if (check.rows.length > 0) { skipped++; } else { await pool.query("INSERT INTO participants (course_id, full_name, phone_number, email, status, age, gender, courses_info, conf_no) VALUES ($1, $2, $3, $4, 'No Response', $5, $6, $7, $8)", [id, name, s.phone||'', s.email||'', s.age||null, s.gender||null, s.courses||null, s.confNo||null]); added++; } } res.json({ message: `Added: ${added}. Skipped: ${skipped}` }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.delete('/participants/:id', async (req, res) => { try { await pool.query("DELETE FROM participants WHERE participant_id = $1", [req.params.id]); res.json({ message: "Deleted successfully" }); } catch (err) { res.status(500).json({ error: err.message }); } });
// ✅ REPLACEMENT ENDPOINT: Create Expense (With Date Support)
app.post('/expenses', async (req, res) => { 
    const { courseId, participantId, type, amount, date } = req.body; 
    try { 
        // If a date is provided, use it; otherwise default to NOW()
        // We append current time to the date string to ensure sorting order remains correct
        const recordDate = date ? `${date} 12:00:00` : new Date();

        const result = await pool.query(
            "INSERT INTO expenses (course_id, participant_id, expense_type, amount, recorded_at) VALUES ($1, $2, $3, $4, $5) RETURNING *", 
            [courseId, participantId, type, amount, recordDate]
        ); 
        res.json(result.rows[0]); 
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    } 
});
app.put('/expenses/:id', async (req, res) => { const { expense_type, amount } = req.body; try { const result = await pool.query("UPDATE expenses SET expense_type=$1, amount=$2 WHERE expense_id=$3 RETURNING *", [expense_type, amount, req.params.id]); res.json(result.rows[0]); } catch (err) { res.status(500).json({ error: err.message }); } });
app.delete('/expenses/:id', async (req, res) => { try { await pool.query("DELETE FROM expenses WHERE expense_id = $1", [req.params.id]); res.json({ message: "Expense deleted" }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/participants/:id/expenses', async (req, res) => { try { const result = await pool.query("SELECT * FROM expenses WHERE participant_id = $1 ORDER BY recorded_at DESC", [req.params.id]); res.json(result.rows); } catch (err) { res.status(500).json({ error: err.message }); } });
// ✅ REPLACEMENT ENDPOINT in backend/index.js
// This calculates Laundry vs Shop totals separately and includes PAID students.

app.get('/courses/:id/financial-report', async (req, res) => { 
  try { 
    const query = `
      SELECT 
        p.full_name, 
        p.room_no, 
        p.dining_seat_no, 
        
        -- 1. Laundry Total (Positive amounts containing 'Laundry')
        COALESCE(SUM(CASE WHEN e.expense_type ILIKE '%Laundry%' AND e.amount > 0 THEN e.amount ELSE 0 END), 0) as laundry_total,

        -- 2. Shop Total (Positive amounts, NOT Laundry, NOT Payments)
        COALESCE(SUM(CASE WHEN e.expense_type NOT ILIKE '%Laundry%' AND e.expense_type NOT ILIKE '%Payment%' AND e.amount > 0 THEN e.amount ELSE 0 END), 0) as shop_total,

        -- 3. Total Bill (Total Spending)
        COALESCE(SUM(CASE WHEN e.amount > 0 THEN e.amount ELSE 0 END), 0) as total_bill, 
        
        -- 4. Net Due (Spending minus Payments)
        COALESCE(SUM(e.amount), 0) as total_due 

      FROM participants p 
      LEFT JOIN expenses e ON p.participant_id = e.participant_id 
      WHERE p.course_id = $1 
      GROUP BY p.participant_id, p.full_name, p.room_no, p.dining_seat_no 
      ORDER BY p.full_name ASC
    `; 
    
    const result = await pool.query(query, [req.params.id]); 
    res.json(result.rows); 
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  } 
});
app.delete('/courses/:id/reset', async (req, res) => { const client = await pool.connect(); try { await client.query('BEGIN'); await client.query('DELETE FROM expenses WHERE course_id = $1', [req.params.id]); await client.query('DELETE FROM participants WHERE course_id = $1', [req.params.id]); await client.query('COMMIT'); res.json({ message: "Course reset" }); } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); } finally { client.release(); } });
app.delete('/courses/:id', async (req, res) => { try { await pool.query('DELETE FROM expenses WHERE course_id = $1', [req.params.id]); await pool.query('DELETE FROM participants WHERE course_id = $1', [req.params.id]); await pool.query('DELETE FROM courses WHERE course_id = $1', [req.params.id]); res.json({ message: "Course deleted" }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/notify', async (req, res) => { const { type, participantId } = req.body; console.log(`Notification ${type} for ${participantId}`); res.json({message:'Sent'}); });
app.post('/courses/:id/auto-noshow', async (req, res) => { try { await pool.query("UPDATE participants SET status='No-Show' WHERE course_id=$1 AND status IN ('No Response','Pending')", [req.params.id]); res.json({message:'Done'}); } catch(err) { res.status(500).json({error:err.message}); } });

app.get('/', (req, res) => res.send('Backend is Live!'));
const PORT = process.env.PORT || 3000;
// ✅ NEW: GLOBAL CONFLICT CHECK
// Finds occupied Dining/Pagoda seats across ALL overlapping courses
app.get('/courses/:id/global-occupied', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Get Date Range of Current Course
        const courseRes = await pool.query("SELECT start_date, end_date FROM courses WHERE course_id = $1", [id]);
        if (courseRes.rows.length === 0) return res.json({ dining: [], pagoda: [] });
        
        const { start_date, end_date } = courseRes.rows[0];

        // 2. Find ALL occupied seats in ANY course that overlaps with this time window
        // Logic: (CourseStart <= TargetEnd) AND (CourseEnd >= TargetStart) = Overlap
        const query = `
            SELECT p.dining_seat_no, p.pagoda_cell_no
            FROM participants p
            JOIN courses c ON p.course_id = c.course_id
            WHERE p.status IN ('Attending', 'Gate Check-In') 
            AND p.course_id != $1
            AND (c.start_date <= $3 AND c.end_date >= $2)
        `;
        
        const result = await pool.query(query, [id, start_date, end_date]);
        
        const dining = result.rows.filter(r => r.dining_seat_no).map(r => r.dining_seat_no.trim());
        const pagoda = result.rows.filter(r => r.pagoda_cell_no).map(r => r.pagoda_cell_no.trim());

        res.json({ dining, pagoda });
    } catch (err) {
        console.error("Global Occupancy Error:", err);
        res.status(500).json({ error: err.message });
    }
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
