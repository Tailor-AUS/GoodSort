-- The Good Sort — Initial Database Schema
-- Run this in Supabase SQL Editor after creating the project

-- ══════════════════════════════════════
-- Depots (must exist first for FK refs)
-- ══════════════════════════════════════
create table if not exists depots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz default now()
);

-- Seed default depot
insert into depots (name, address, lat, lng)
values ('Tomra South Brisbane', '201 Montague Rd, West End', -27.4790, 153.0080);

-- ══════════════════════════════════════
-- Households
-- ══════════════════════════════════════
create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  pending_containers int default 0,
  pending_value_cents int default 0,
  materials jsonb default '{"aluminium":0,"pet":0,"glass":0,"other":0}'::jsonb,
  estimated_weight_kg real default 0,
  estimated_bags int default 0,
  last_scan_at timestamptz,
  created_at timestamptz default now()
);

-- ══════════════════════════════════════
-- User profiles (extends auth.users)
-- ══════════════════════════════════════
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  household_id uuid references households(id),
  role text default 'sorter' check (role in ('sorter', 'driver', 'both')),
  pending_cents int default 0,
  cleared_cents int default 0,
  total_containers int default 0,
  total_co2_saved_kg real default 0,
  badges text[] default '{}',
  created_at timestamptz default now()
);

-- ══════════════════════════════════════
-- Routes
-- ══════════════════════════════════════
create table if not exists routes (
  id uuid primary key default gen_random_uuid(),
  status text default 'pending' check (status in ('pending', 'claimed', 'in_progress', 'at_depot', 'settled', 'cancelled')),
  driver_id uuid references profiles(id),
  total_containers int default 0,
  total_weight_kg real default 0,
  total_value_cents int default 0,
  driver_payout_cents int default 0,
  estimated_duration_min int default 0,
  estimated_distance_km real default 0,
  depot_id uuid references depots(id),
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz default now()
);

-- ══════════════════════════════════════
-- Route stops
-- ══════════════════════════════════════
create table if not exists route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid references routes(id) on delete cascade not null,
  household_id uuid references households(id) not null,
  household_name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  container_count int default 0,
  estimated_bags int default 0,
  materials jsonb,
  status text default 'pending' check (status in ('pending', 'picked_up', 'skipped')),
  actual_container_count int,
  picked_up_at timestamptz,
  sequence int not null,
  created_at timestamptz default now()
);

-- ══════════════════════════════════════
-- Scans
-- ══════════════════════════════════════
create table if not exists scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  household_id uuid references households(id) not null,
  barcode text not null,
  container_name text not null,
  material text not null,
  refund_cents int default 10,
  status text default 'pending' check (status in ('pending', 'in_route', 'settled')),
  route_id uuid references routes(id),
  created_at timestamptz default now()
);

-- ══════════════════════════════════════
-- Collections (earning records)
-- ══════════════════════════════════════
create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  route_id uuid references routes(id) not null,
  stop_count int default 0,
  total_containers int default 0,
  earned_cents int default 0,
  depot_name text,
  created_at timestamptz default now()
);

-- ══════════════════════════════════════
-- Cashout requests (Phase 2)
-- ══════════════════════════════════════
create table if not exists cashout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  amount_cents int not null,
  bsb text,
  account_number text,
  account_name text,
  status text default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  processed_at timestamptz,
  created_at timestamptz default now()
);

-- ══════════════════════════════════════
-- Row Level Security
-- ══════════════════════════════════════
alter table profiles enable row level security;
alter table households enable row level security;
alter table scans enable row level security;
alter table routes enable row level security;
alter table route_stops enable row level security;
alter table depots enable row level security;
alter table collections enable row level security;
alter table cashout_requests enable row level security;

-- Profiles: read own, update own
create policy "Users can read own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on profiles for insert with check (auth.uid() = id);

-- Households: all authenticated can read, members can update
create policy "Authenticated can read households" on households for select to authenticated using (true);
create policy "Authenticated can insert households" on households for insert to authenticated with check (true);
create policy "Authenticated can update households" on households for update to authenticated using (true);

-- Scans: users can read/create their own
create policy "Users can read own scans" on scans for select using (auth.uid() = user_id);
create policy "Users can create scans" on scans for insert with check (auth.uid() = user_id);
create policy "Users can update own scans" on scans for update using (auth.uid() = user_id);

-- Routes: all authenticated can read, drivers can update
create policy "Authenticated can read routes" on routes for select to authenticated using (true);
create policy "Authenticated can create routes" on routes for insert to authenticated with check (true);
create policy "Drivers can update routes" on routes for update to authenticated using (true);

-- Route stops: same as routes
create policy "Authenticated can read stops" on route_stops for select to authenticated using (true);
create policy "Authenticated can create stops" on route_stops for insert to authenticated with check (true);
create policy "Authenticated can update stops" on route_stops for update to authenticated using (true);

-- Depots: all authenticated can read
create policy "Authenticated can read depots" on depots for select to authenticated using (true);

-- Collections: users can read own, insert own
create policy "Users can read own collections" on collections for select using (auth.uid() = user_id);
create policy "Users can create collections" on collections for insert with check (auth.uid() = user_id);

-- Cashout requests: users can read/create own
create policy "Users can read own cashouts" on cashout_requests for select using (auth.uid() = user_id);
create policy "Users can create cashouts" on cashout_requests for insert with check (auth.uid() = user_id);

-- ══════════════════════════════════════
-- Indexes for performance
-- ══════════════════════════════════════
create index idx_scans_user on scans(user_id);
create index idx_scans_household on scans(household_id);
create index idx_scans_status on scans(status);
create index idx_routes_status on routes(status);
create index idx_routes_driver on routes(driver_id);
create index idx_route_stops_route on route_stops(route_id);
create index idx_households_location on households using gist (
  ll_to_earth(lat, lng)
);
create index idx_collections_user on collections(user_id);

-- ══════════════════════════════════════
-- Auto-create profile on auth signup
-- ══════════════════════════════════════
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'New User'),
    new.phone
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
