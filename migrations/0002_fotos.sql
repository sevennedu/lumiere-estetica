-- Lumière Estética: conversão das imagens de serviços e profissionais de .svg para .jpg
UPDATE services SET image = REPLACE(image, '.svg', '.jpg');
UPDATE professionals SET photo = REPLACE(photo, '.svg', '.jpg');
