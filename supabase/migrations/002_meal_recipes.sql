CREATE TABLE IF NOT EXISTS meal_recipes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  ingredients jsonb DEFAULT '[]',
  recipe text DEFAULT '',
  calories numeric DEFAULT 0,
  protein numeric DEFAULT 0,
  carbs numeric DEFAULT 0,
  fat numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE meal_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own recipes"
  ON meal_recipes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
