-- Xypher Supabase Setup
-- Run this in the Supabase SQL editor

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  business_name text not null,
  business_type text default 'Sonstiges',
  created_at timestamp default now()
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  caller_number text,
  call_type text default 'inquiry',
  summary text,
  transcript text,
  duration_seconds integer,
  details jsonb,
  created_at timestamp default now()
);

-- Optional: Enable Row Level Security (RLS)
-- alter table clients enable row level security;
-- alter table calls enable row level security;

-- Indexes for performance
create index if not exists calls_client_id_idx on calls(client_id);
create index if not exists calls_created_at_idx on calls(created_at desc);
