# Prototipo de investigación de EnergiPyme

Este prototipo ejecuta en el navegador un detector ligero de anomalías y genera una explicación contextual para cada alerta. No transmite ni almacena los datos.

## Ejecución

Abra `index.html` en un navegador moderno y seleccione **Usar datos de demostración**. También puede cargar un CSV con estas columnas:

```text
timestamp,kwh,tariff_crc_per_kwh
2026-08-03T00:00:00,1.20,118.25
```

Se requieren al menos 24 lecturas y no se aceptan timestamps repetidos. Para una señal más estable se recomiendan siete días de datos horarios.

Tras el análisis, la sección **Comprobar: plan de acción** permite elegir una alerta, registrar la hipótesis a verificar, el responsable y la fecha de la acción, y comparar el consumo promedio diario (kWh o colones) antes y después de esa fecha. La comparación no demuestra causalidad y exige al menos 24 lecturas en cada periodo. El plan no se guarda: vive solo en la página abierta.

## Prueba automatizada

Con Node.js instalado, ejecute:

```bash
node test_engine.js
```

La prueba verifica cobertura, que las alertas sean exactamente las dos desviaciones inyectadas (lecturas 118 y 239), reproducibilidad, presencia de explicaciones, rechazo de timestamps duplicados y la comparación antes/después.

## Alcance técnico

- `engine.js` implementa un Isolation Forest ligero con semilla fija.
- La explicación contextual compara el consumo con la mediana de la misma hora y tipo de día.
- Una alerta significa que la lectura superó el umbral del modelo y el umbral de desviación contextual.
- El sistema no identifica automáticamente la causa física ni atribuye el evento a un equipo.

## Datos y privacidad

Los datos de demostración son sintéticos. Para pruebas de campo deben utilizarse datos anonimizados o autorizados y evitarse números de abonado, direcciones y otros identificadores innecesarios.

## Interfaz V4 (index.html)

`index.html` sigue el flujo del diseño V4 en cinco pantallas: fuente y tarifa, detección semanal con días de cierre y nota de contexto, explicación (observado vs. hipótesis, prioridad de revisión y calidad de evidencia), plan de acción con plantillas por sector y resultado antes/después con retorno frente a la suscripción. Usa el motor en modo diario (`toDaily`, `analyzeDaily`, `measureImpact`). La tarifa de 104,50 CRC/kWh, el plan de 10 000 CRC/mes y la lógica de prioridad, calidad de evidencia y meta de consumo son valores de demostración sin validar. El recordatorio de cierre solo se registra. `laboratorio.html` conserva la vista horaria original.
