# WMS Acatlán — Prototipo Paso 1

Incluye catálogos reales extraídos de `Base WMS(1).xlsx`, dashboard, login de demostración y una recepción funcional en navegador con:

- Captura en piezas.
- Conversión automática a tarimas, resto y posiciones.
- Vida útil y caducidad calculadas.
- Sugerencia de ubicación por capacidad exacta y niveles altos.
- Varias líneas de producto/lote por recepción.

## Ejecutar

Desde esta carpeta:

```bash
python -m http.server 8000
```

Abrir `http://localhost:8000`.

Usuario demo: `supervisor`  
Contraseña: `demo`

## Alcance de esta entrega

Es un prototipo local de interfaz. `schema.sql` contiene la base inicial PostgreSQL para convertirlo en aplicación multiusuario. La siguiente etapa conectará autenticación real, persistencia, recepciones y liberación de Calidad.
