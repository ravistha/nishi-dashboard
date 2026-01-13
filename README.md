# Nunavut Community Index Dashboard (NISHI)

A standalone, interactive dashboard for visualizing the Nunavut Index data.

## features
- **Interactive Visualization**: Radar charts and bar graphs using Chart.js.
- **Adjustable Weighting**: Users can customize domain and indicator weights to calculate their own index scores.
- **Real-time Data**: Connects to a Supabase backend for live data fetching.
- **Zero-Build**: Pure HTML/JS/CSS. No Node.js build steps required.

## Files
- `index.html`: The complete application. Contains all HTML, Logic, and Styling. Open this file in your browser to run the dashboard.
- `setup_database.sql`: SQL commands to set up your Supabase database schema and RLS policies.

## How to Edit
Since the logic is inlined for portability:
1. Open `index.html` in VS Code.
2. Scroll to the `<script>` tag at the bottom to modify logic.
3. Scroll to `<style>` for CSS changes.

## Deployment
Simply upload `index.html` to any static host:
- GitHub Pages
- Vercel
- Netlify

## Database
This app requires a Supabase project.
1. Create a project at [supabase.com](https://supabase.com).
2. Run the logic in `setup_database.sql` in the SQL Editor.
3. Import your CSV data into the `NISHI Index Database` table.
4. Update `SUPABASE_URL` and `SUPABASE_KEY` in `index.html`.
