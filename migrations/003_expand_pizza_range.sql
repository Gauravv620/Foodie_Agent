-- Expansion Migration: Add premium, artisan, and diverse pizza catalogue across multiple budget tiers (₹499 to ₹899)
-- Allows rich diversity for queries like "pizza under 1000"

-- Slice Society (Gourmet Neapolitan & Sourdough additions)
INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'ss-truffle-burrata','slice-society','Truffle Burrata Artisan Pizza','Italian black truffle cream, whole artisanal burrata, wild mushrooms, and fresh basil on 48-hr slow-fermented crust.','pizza',TRUE,69900,18,'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","gourmet","burrata","truffle"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='ss-truffle-burrata');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'ss-quattro-premium','slice-society','Quattro Formaggi Grande','Imported Gorgonzola, aged Parmigiano-Reggiano, fontina, smoked scamorza, and wild honeycomb drizzle.','pizza',TRUE,74900,17,'https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","cheese","gourmet","premium"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='ss-quattro-premium');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'ss-parma-chicken','slice-society','Prosciutto & Smoked Chicken Feast','Smoked herb chicken, crispy cured strips, sun-dried tomatoes, arugula, and shaved pecorino.','pizza',FALSE,79900,19,'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85',TRUE,'["non-vegetarian","chicken","gourmet"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='ss-parma-chicken');

-- Urban Oven (Wood-fired signature additions)
INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'uo-pesto-burrata','urban-oven','Genovese Pesto & Burrata Pizza','House-made pine nut basil pesto base, fresh burrata, blistered heirloom cherry tomatoes, and balsamic reduction.','pizza',TRUE,65900,17,'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","pesto","burrata","wood-fired"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='uo-pesto-burrata');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'uo-wild-mushroom','urban-oven','Wild Forest Mushroom & Truffle','Porcini and shiitake mushrooms, thyme garlic butter, fior di latte, and white truffle oil drizzle.','pizza',TRUE,59900,16,'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","mushroom","wood-fired"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='uo-wild-mushroom');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'uo-carnivore-delight','urban-oven','Smoked Chicken Pepperoni Rustica','Double chicken pepperoni, spicy chicken sausage, smoked paprika, roasted bell peppers, and melted provolone.','pizza',FALSE,72900,19,'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=85',TRUE,'["non-vegetarian","pepperoni","chicken","wood-fired"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='uo-carnivore-delight');

-- Fire Crust Social (Bold, spicy fusion & loaded styles)
INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'fc-devil-peri','fire-crust','Firestorm Peri Peri Loaded Pizza','Fiery bird''s eye chili sauce, spicy paneer chunks, roasted corn, red jalapeños, and ghost pepper cheese blend.','pizza',TRUE,54900,17,'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","spicy","peri-peri"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='fc-devil-peri');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'fc-butter-chicken-pizza','fire-crust','Delhi Makhani Butter Chicken Pizza','Tandoori roasted chicken tikka in velvety butter makhani reduction, kasuri methi, pickled onions, and mozzarella.','pizza',FALSE,68900,18,'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=85',TRUE,'["non-vegetarian","indian","chicken","spicy"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='fc-butter-chicken-pizza');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'fc-smokehouse-bbq','fire-crust','Smokehouse Texas BBQ Chicken Pizza','Slow-smoked barbecue chicken, caramelized shallots, smoked gouda, crispy onion straws, and fresh cilantro.','pizza',FALSE,71900,19,'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?auto=format&fit=crop&w=900&q=85',TRUE,'["non-vegetarian","bbq","chicken"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='fc-smokehouse-bbq');

-- Green Slice Kitchen (Artisanal organic & gourmet vegetarian)
INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'gs-mediterranean-artisan','green-slice','Mediterranean Sun-dried Olive Artisan','Kalamata olives, Greek feta, artichoke hearts, sun-dried tomatoes, roasted garlic, and oregano olive oil.','pizza',TRUE,57900,16,'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","mediterranean","healthy"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='gs-mediterranean-artisan');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'gs-exotic-farmhouse-burst','green-slice','Exotic Farmhouse Cheese Burst','Golden liquid cheese burst crust topped with asparagus, yellow zucchini, baby corn, button mushrooms, and bocconcini.','pizza',TRUE,62900,17,'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","cheese-burst","exotic"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='gs-exotic-farmhouse-burst');

-- Oven & Olive (Classic Italian & Rustic Handcrafted)
INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'oo-florentine-gourmet','oven-olive','Florentine Spinach & Ricotta Pizza','Garlic cream sauce, fresh baby spinach, herb-whipped ricotta, toasted walnuts, and mozzarella on sourdough crust.','pizza',TRUE,58900,16,'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","ricotta","italian"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='oo-florentine-gourmet');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'oo-gourmet-diavola','oven-olive','Diavola Spiced Salami & Herb Pizza','Calabrian spiced chicken pepperoni, spicy hot honey drizzle, fresh fior di latte, and fresh oregano.','pizza',FALSE,67900,18,'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=85',TRUE,'["non-vegetarian","spicy","diavola"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='oo-gourmet-diavola');

-- Pune Pizza Works (Substantial sharing pizza under 1000)
INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'pp-monster-feast','pune-pizza-works','Monster 14-Inch Veggie Feast Pizza','Colossal 14-inch pizza loaded with paneer cubes, crisp capsicum, caramelized onions, black olives, and 3-cheese blend.','pizza',TRUE,64900,18,'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=85',TRUE,'["vegetarian","large","sharing","budget"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='pp-monster-feast');

INSERT INTO fa_menu_items (id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags)
SELECT 'pp-triple-meat-blast','pune-pizza-works','Triple Chicken Extreme Feast','Grilled chicken chunks, chicken sausage slices, barbecue chicken strips, red paprika, and extra cheese.','pizza',FALSE,74900,19,'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?auto=format&fit=crop&w=900&q=85',TRUE,'["non-vegetarian","chicken","large"]'
WHERE NOT EXISTS (SELECT 1 FROM fa_menu_items WHERE id='pp-triple-meat-blast');

