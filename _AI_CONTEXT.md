# PROJECT DHAMMA - AI CONTEXT FILE
**Status:** Stable Production (Mark: "Dhamma Release")
**Stack:** React (Vite) + Node.js (Express) + PostgreSQL (Supabase)
**Hosting:** Vercel (Frontend) + Render (Backend)

## 1. CORE RULES (Do Not Break)
- **Auth:** Admin passcode is hardcoded as "1234" in `App.jsx`.
- **Database:** We use Supabase/PostgreSQL.
- **Protected Rooms:** The code explicitly protects rooms like "301AI", "301BI" etc. from deletion.
- **Environment:**
  - Frontend connects via `import.meta.env.VITE_API_URL` (Staging setup).
  - Backend connects via `process.env.DATABASE_URL`.

## 2. DATABASE SCHEMA (Reference)
- **courses:** course_id (PK), course_name, teacher_name, start_date, end_date.
- **rooms:** room_id (PK), room_no (Unique), gender_type, status (default 'Active').
- **participants:** participant_id (PK), full_name, age, gender, status ('Arrived', 'No Response'), room_no, dining_seat_no, process_stage, token_number.
- **expenses:** expense_id (PK), amount, expense_type.

## 3. KEY FILE STRUCTURE
- **Frontend (`src/App.jsx`):** - `Dashboard`: Zero-day stats.
  - `GlobalAccommodationManager`: Room grid with Maintenance toggle.
  - `StudentForm`: Check-in logic.
- **Backend (`index.js`):** - `/process/arrival`: Auto-assigns tokens.
  - `/check-in`: Updates status to 'Arrived' and assigns room/seats.
  - `/rooms`: Handles CRUD and Maintenance Status.

## 4. DEPLOYMENT PIPELINE
- **Production (Dhamma):** `main` branch -> Deploys to Render/Vercel (Prod DB).
- **Staging:** `staging` branch -> Deploys to Render/Vercel (Staging DB).
