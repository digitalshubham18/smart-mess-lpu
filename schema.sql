-- Smart Mess — suggested PostgreSQL schema
-- This mirrors the TypeScript models in src/types/index.ts.
-- Not applied automatically; provided as a starting point for the Node/Express + PostgreSQL backend.

CREATE TYPE role AS ENUM ('ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'STUDENT', 'FINANCE_MANAGER', 'HOSTEL_WARDEN');
CREATE TYPE meal_type AS ENUM ('breakfast', 'lunch', 'snacks', 'dinner');
CREATE TYPE intention_status AS ENUM ('will_eat', 'maybe', 'will_not', 'unconfirmed');
CREATE TYPE po_status AS ENUM ('Pending', 'Approved', 'Ordered', 'Delivered', 'Cancelled');
CREATE TYPE complaint_status AS ENUM ('Open', 'In Progress', 'Resolved', 'Rejected');
CREATE TYPE event_type AS ENUM ('holiday', 'exam', 'event', 'festival', 'sports', 'vacation');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role role NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE hostels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  capacity INT NOT NULL,
  occupancy INT NOT NULL DEFAULT 0
);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  hostel_id UUID REFERENCES hostels(id),
  room TEXT,
  year INT,
  branch TEXT,
  meal_preference TEXT CHECK (meal_preference IN ('veg', 'non-veg', 'either')),
  status TEXT DEFAULT 'active',
  points INT DEFAULT 0
);

CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  veg BOOLEAN NOT NULL DEFAULT true,
  calories NUMERIC,
  protein NUMERIC,
  carbs NUMERIC,
  fat NUMERIC,
  fiber NUMERIC,
  popularity NUMERIC DEFAULT 1,
  serving_size_kg NUMERIC NOT NULL,
  cost_per_kg NUMERIC NOT NULL
);

CREATE TABLE menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  is_special BOOLEAN DEFAULT false,
  label TEXT,
  UNIQUE (date, meal)
);

CREATE TABLE menu_menu_items (
  menu_id UUID REFERENCES menus(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_id, menu_item_id)
);

CREATE TABLE meal_intentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  status intention_status NOT NULL DEFAULT 'unconfirmed',
  submitted_at TIMESTAMPTZ,
  UNIQUE (student_id, date, meal)
);

CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  hostel_id UUID REFERENCES hostels(id),
  scanned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (student_id, date, meal)
);

CREATE TABLE forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  method TEXT NOT NULL,
  predicted_students INT NOT NULL,
  confidence NUMERIC,
  recommended_quantity_kg NUMERIC,
  expected_leftover NUMERIC,
  expected_waste NUMERIC,
  expected_cost NUMERIC,
  safety_buffer_pct NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE forecast_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  predicted INT NOT NULL,
  actual INT NOT NULL,
  difference INT GENERATED ALWAYS AS (actual - predicted) STORED,
  absolute_error INT GENERATED ALWAYS AS (abs(actual - predicted)) STORED
);

CREATE TABLE food_preparation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  item_id UUID REFERENCES menu_items(id),
  prepared_kg NUMERIC NOT NULL
);

CREATE TABLE food_consumption (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  item_id UUID REFERENCES menu_items(id),
  consumed_kg NUMERIC NOT NULL
);

CREATE TABLE food_waste (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  item_id UUID REFERENCES menu_items(id),
  prepared_kg NUMERIC,
  served_kg NUMERIC,
  consumed_kg NUMERIC,
  leftover_kg NUMERIC,
  waste_kg NUMERIC,
  reason TEXT,
  cost_per_kg NUMERIC
);

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  min_stock NUMERIC NOT NULL,
  max_stock NUMERIC NOT NULL,
  expiry_date DATE,
  supplier_id UUID,
  purchase_price NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  rating NUMERIC
);

ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT UNIQUE NOT NULL,
  supplier_id UUID REFERENCES suppliers(id),
  total NUMERIC NOT NULL,
  status po_status NOT NULL DEFAULT 'Pending',
  delivery_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id UUID REFERENCES inventory_items(id),
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  price NUMERIC NOT NULL
);

CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal meal_type NOT NULL,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  taste INT, quality INT, variety INT, quantity INT,
  comment TEXT
);

CREATE TABLE complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  category TEXT,
  subject TEXT,
  description TEXT,
  status complaint_status NOT NULL DEFAULT 'Open'
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  target_roles role[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  date DATE NOT NULL,
  type event_type NOT NULL,
  demand_impact_pct NUMERIC DEFAULT 0
);

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  description TEXT
);

-- Helpful indexes
CREATE INDEX idx_intentions_date_meal ON meal_intentions (date, meal);
CREATE INDEX idx_attendance_date_meal ON attendance (date, meal);
CREATE INDEX idx_waste_date_meal ON food_waste (date, meal);
CREATE INDEX idx_forecasts_date_meal ON forecasts (date, meal);
CREATE INDEX idx_students_hostel ON students (hostel_id);
