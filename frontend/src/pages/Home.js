// Node packages
import React, { useState, useEffect, useCallback } from 'react';
import Flatpickr from 'react-flatpickr';
import L from 'leaflet';
import 'leaflet-textpath';
import 'leaflet.vectorgrid';
import 'leaflet-geometryutil';


// Custom JS
import { useMapInit, useSkewInit, useAjaxReadout, 
         usePtypeLayerLoader, useSoundingData, useMapMouseEvents,
         useSoundingPlot, useSendModifiedSounding } from '../hooks/Hooks.js';
import { extractDateComponents, calculateValidDateTime, debounce, styleFeatureLayer } from '../js/utils.js';

// CSS
import '../css/App.css';
import '../css/sounding.css';
import "flatpickr/dist/themes/material_green.css";
import 'leaflet/dist/leaflet.css';

// Assets
import ncar from '../assets/ncar.png';
import cira from '../assets/CIRA.png';
import ai2es from '../assets/ai2es.png';
import colorbar from '../assets/colorbarnew.png';


const Home = () => {

    // Date + Time Components
    const [selectedDate, setSelectedDate] = useState(new Date(2024,3,30));
    const [selectedInitialization, setSelectedInitialization] = useState('00Z');
    const [sliderValue, setSliderValue] = useState(1);
    const [draggingSliderValue, setDraggingSliderValue] = useState(sliderValue);

    // Overlay states and configurations
    const [activeOverlays, setActiveOverlays] = useState([]);
    const [overlayState, setOverlayState] = useState({
        hrrr_t: {
            visible: false,
            label: "2 m Temperature",
            dir: "hrrr_t",
            prefix: "hrrr",
            varname: "t",
            layer: null,
            minVal: -30,
            maxVal: 25,
            hue: 0 
        },
        hrrr_td: {
            visible: false,
            label: "2 m Dewpoint",
            dir: "hrrr_td",
            prefix: "hrrr",
            varname: "td",
            layer: null,
            minVal: -30,
            maxVal: 25,
            hue: 150
        },
        hrrr_wb: {
            visible: false,
            label: "2 m Wetbulb",
            dir: "hrrr_wb",
            prefix: "hrrr",
            varname: "wb",
            layer: null,
            minVal: -30,
            maxVal: 25,
            hue: 210
        },
        hrrr_u10: {
            visible: false,
            label: "10 m U-wind Component",
            dir: "hrrr_u10",
            prefix: "hrrr",
            varname: "u10",
            layer: null,
            minVal: -30,
            maxVal: 30,
            hue: 270
        },
        hrrr_v10: {
            visible: false,
            label: "10 m V-wind Component",
            dir: "hrrr_v10",
            prefix: "hrrr",
            varname: "v10",
            layer: null,
            minVal: -30,
            maxVal: 30,
            hue: 330
        },
        hrrr_mslp: {
            visible: false,
            label: "MSLP",
            dir: "hrrr_mslp",
            prefix: "hrrr",
            varname: "mslp",
            layer: null,
            minVal: 98800, 
            maxVal: 104800,
            hue: 150
        },
        hrrr_rain: {
            visible: false,
            label: "HRRR Rain",
            dir: "hrrr_rain",
            prefix: "hrrr",
            varname: "hrrr_rain",
            layer: null,
            minVal: 0,
            maxVal: 1,
            hue: 120
        },
        hrrr_snow: {
            visible: false,
            label: "HRRR Snow",
            dir: "hrrr_snow",
            prefix: "hrrr",
            varname: "hrrr_snow",
            layer: null,
            minVal: 0,
            maxVal: 1,
            hue: 240
        },
        hrrr_icep: {
            visible: false,
            label: "HRRR Ice Pellets",
            dir: "hrrr_icep",
            prefix: "hrrr",
            varname: "hrrr_icep",
            layer: null,
            minVal: 0,
            maxVal: 1,
            hue: 273
        },
        hrrr_frzr: {
            visible: false,
            label: "HRRR Freezing Rain",
            dir: "hrrr_frzr",
            prefix: "hrrr",
            varname: "hrrr_frzr",
            layer: null,
            minVal: 0,
            maxVal: 1,
            hue: 354
        },
        evi_uncertainty: {
            visible: false,
            label: "Epistemic Uncertainty",
            dir: "evi_uncertainty",
            prefix: "evi",
            varname: "uncertainty",
            layer: null,
            minVal: 0,
            maxVal: 1,
            hue: 20
        }
    });
    

    // Skew-T values
    const [uncertainty, setUncertainty] = useState(0)
    const [temp, setTemp] = useState();
    const [dpt, setDpt] = useState();
    const [uwind, setUwind] = useState();
    const [vwind, setVwind] = useState();
    const [mod, setMod] = useState(0);
    const [pres, setPres] = useState();
    const [rain, setRain] = useState(0);
    const [snow, setSnow] = useState(0);
    const [icep, setIcep] = useState(0);
    const [frzr, setFrzr] = useState(0);

    // Skew-t options
    const [reset,setReset] = useState(false)
    const [rhLock,setRhLock] = useState(false)
    const [metrics,setMetrics] = useState(null)

    // SVG elements (for easy changing)
    const [svg, setSvg] = useState();
    const [barsvg, setBarsvg] = useState();
    const [width, setWidth] = useState(500);
    const [height, setHeight] = useState(500);
    const [margin, setMargin] = useState([30, 40, 20, 35]);
    const [basep, setBasep] = useState(1050);
    const [topp, setTopp] = useState(300);
    const [tan, setTan] = useState(Math.tan(55 * (Math.PI / 180)));
    const [barbsize, setBarbsize] = useState(25);
    const [plines, setPlines] = useState([1000, 850, 700, 500, 300, 200, 100]);
    const [pticks, setPticks] = useState([1000, 950, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100]);
    const [w, setW] = useState();
    const [h, setH] = useState();

    // Map elements
    const [lat, setLat] = useState(0);
    const [lon, setLon] = useState(0);

    // Handles the change in the initialization dropdown.
    const handleInitializationChange = (event) => {
        setSelectedInitialization(event.target.value);
    };

    // Handles the change in the slider value.
    const handleSliderChange = (event) => {
        debounce(setDraggingSliderValue(parseInt(event.target.value)),500);
    };

    // Updates the actual slider value when dragging stops.
    const handleSliderMouseUp = () => {
        debounce(setSliderValue(draggingSliderValue),500);
    };

    // Handles changes to overlay fields (thanks ChatGPT)
    const toggleOverlay = (key) => {
        setOverlayState((prev) => {
            const newVisible = !prev[key].visible;
            if (!newVisible && prev[key].layer) {
                window.LeafletMap.removeLayer(prev[key].layer);
            }
    
            // Update active overlays only when visibility changes
            setActiveOverlays((curr) =>
                newVisible
                    ? [...curr, key]
                    : curr.filter((k) => k !== key)
            );
    
            return {
                ...prev,
                [key]: {
                    ...prev[key],
                    visible: newVisible,
                    layer: newVisible ? prev[key].layer : null,
                },
            };
        });
    };
    
    // Handles changes to relative humidity lock state
    const handleRhLockChange = (event) => {
        setRhLock(event.target.checked);
    }

    // Part of data sampling
    // Debounced so it doesn't fire constantly when mouse is moved
    const debouncedHandleAjaxCall = useCallback(
        debounce(useAjaxReadout({ selectedDate, selectedInitialization, draggingSliderValue }), 100),
        [selectedDate, selectedInitialization, draggingSliderValue]
    );
    

    // Handles mouse movement over the map to sample data
    const handleMouseMove = useCallback((e) => {
        var x = e.containerPoint.x + 10;
        var y = e.containerPoint.y - 50;
        document.getElementById("readout").style.display = "block";
        document.getElementById("readout").style.top = y + "px";
        document.getElementById("readout").style.left = x + "px";
        debouncedHandleAjaxCall(e);
    }, [debouncedHandleAjaxCall]);

    // Handles mouse leave event to hide the readout
    const handleMouseLeave = () => {
        document.getElementById("readout").style.display = 'none';
    }   

    // Handles mouse moves over map
    useMapMouseEvents(handleMouseMove, handleMouseLeave);

    // Leaflet map initialization
    useMapInit( {setLat, setLon} )

    // Skew-T and bar chart initialization 
    useSkewInit({
        svg, width, height, margin, basep, topp,
        plines, pticks, barbsize, tan,
        rain, snow, icep, frzr, uncertainty,
        setSvg, setBarsvg, setW, setH, setReset
    });

    // Loads main ptype layer
    usePtypeLayerLoader({ selectedDate, selectedInitialization, sliderValue });

    // Loads skew-t when map is clicked (or date changed)
    useSoundingData({
        lat, lon, selectedDate, selectedInitialization, sliderValue, reset,
        setTemp, setDpt, setPres, setRain, setSnow, setIcep, setFrzr,
        setUwind, setVwind, setMetrics, setUncertainty, setMod
      });
    

    // Loads overlay data
    // Weird stuff happened when I tried to move it to Hooks
    useEffect(() => {
        activeOverlays.forEach(async (key) => {
            const info = overlayState[key];
            if (!info || !info.visible) return;

            // Min and max values of field
            const minVal = info.minVal
            const maxVal = info.maxVal

            // Hue for field
            const hue = info.hue
    
            // Date info
            const { year, month, day, hh, fhour } = extractDateComponents(selectedDate, selectedInitialization, sliderValue);

            // File containing relevant data
            const file = `./${info.dir}/MILES_ptype_${info.prefix}_${year}-${month}-${day}_${hh}00_f${fhour}_${info.varname}.geojson`;

            // Retrieve data
            const response = await fetch(file).then(res => res.json()).catch(() => null);

            if (!response) return;

            // Create and add layer
            var newLayer = L.geoJSON(response, {
                myid: 'geojson',
                onEachFeature: function (feature, layer) {
                    try {
                        var length = L.GeometryUtil.length(L.geoJSON(feature).getLayers()[0].getLatLngs()) / 1000;
                        if (length > 250) {
                            styleFeatureLayer(key, feature, layer, hue, minVal, maxVal)
                        }
                        else {
                            layer.setStyle({ opacity: 0, fillOpacity: 0 });
                        }
                    }

                    catch {
                        styleFeatureLayer(key, feature, layer, hue, minVal, maxVal)
                    }
                }
            });
    
            newLayer.addTo(window.LeafletMap);
    
            // Update states and remove old layers
            setOverlayState(prev => {
                const existingLayer = prev[key].layer;
                if (existingLayer) {
                    window.LeafletMap.removeLayer(existingLayer);
                }
    
                return {
                    ...prev,
                    [key]: {
                        ...prev[key],
                        layer: newLayer,
                    }
                };
            });
        });
    }, [activeOverlays, selectedDate, selectedInitialization, sliderValue]);
    
    
    // Retrieve skew-T data
    useSoundingPlot({
        temp,
        dpt,
        pres,
        w,
        h,
        basep,
        topp,
        tan,
        svg,
        barsvg,
        selectedDate,
        selectedInitialization,
        sliderValue,
        rain,
        snow,
        icep,
        frzr,
        uncertainty,
        rhLock,
        setTemp,
        setDpt,
        setMod
    });

    // Retrieve new predictions after updating skew-T
    useSendModifiedSounding({
        mod,
        temp,
        dpt,
        uwind,
        vwind,
        setRain,
        setSnow,
        setIcep,
        setFrzr,
        setUncertainty,
        setMetrics,
        barsvg,
        selectedDate,
        selectedInitialization,
        sliderValue
    });

    // HTML
    return (
        <div id="main">
            <div id="logos">
                <img src={ncar} alt="ncar logo" id="ncar" />
                <img src={cira} alt="cira logo" id="cira" />
                <img src={ai2es} alt="ai2es logo" id="ai2es" />
            </div>
            <div id="all">
                <div id="timing">
                    <p id="initializationtext">HRRR Initialization: </p>
                    <div id="calendar">
                        <Flatpickr
                            value={selectedDate}
                            onChange={date => setSelectedDate(date[0])}
                            options={{ 
                                dateFormat: 'Y-m-d',
                                minDate: '2023-11-01',
                                maxDate: '2024-04-30'    
                            }} // Specify date format
                            style={{ textAlign: 'center' }}
                        />
                    </div>
                    <div id="initialization">
                        <select value={selectedInitialization} onChange={handleInitializationChange} style={{ paddingBlock: '1px', paddingInline: '2px' }}>
                            <option value="00Z">00Z</option>
                            <option value="12Z">12Z</option>
                        </select>
                    </div>
                    <div id="slider">
                        <input
                            type="range"
                            min="1"
                            max="18"
                            value={draggingSliderValue}
                            onChange={handleSliderChange}
                            onMouseUp={handleSliderMouseUp}
                            onKeyDown={handleSliderMouseUp}
                            onKeyUp={handleSliderMouseUp}
                            className="slider-input"
                        />
                        <div id="slider-value" style={{ textAlign: 'center' }}>
                            {`F${String(draggingSliderValue).padStart(2, '0')}`}
                        </div>
                        <div id="valid-date-time" style={{ textAlign: 'center' }}>
                            {`Valid: ${calculateValidDateTime(draggingSliderValue, selectedDate, selectedInitialization)}`}
                        </div>
                    </div>
                </div>
                <div id="resize"> 
                    <div id="leftside">
                        <div id="radarmap">
                            <img src={colorbar} alt="colorbar" id="colorbar" />
                            <div id="readout"><p id="readouttext"></p></div>
                            <div id="temperature-checkbox">
                                <div id="overlaysdiv">
                                    <div id="mloverlays">
                                        <p className="overlays">ML Overlays: </p>
                                        {Object.entries(overlayState)
                                            .filter(([key]) => key.startsWith('evi_'))
                                            .map(([key, info]) => (
                                                <label key={key}>
                                                    <input
                                                        type="checkbox"
                                                        checked={info.visible}
                                                        onChange={() => toggleOverlay(key)}
                                                    />
                                                    {info.label}
                                                </label>
                                            ))}
                                    </div>

                                    <div id="hrrroverlays">
                                        <div id="hrrrvars">
                                            <p className="overlays">HRRR Overlays: </p>
                                            {Object.entries(overlayState)
                                                .filter(([key]) => ['hrrr_t', 'hrrr_td', 'hrrr_wb'].includes(key))
                                                .map(([key, info]) => (
                                                    <label key={key}>
                                                        <input
                                                            type="checkbox"
                                                            checked={info.visible}
                                                            onChange={() => toggleOverlay(key)}
                                                        />
                                                        {info.label}
                                                    </label>
                                                ))}
                                        </div>

                                        <div id="hrrrwindoverlays">
                                            {Object.entries(overlayState)
                                                .filter(([key]) => ['hrrr_mslp', 'hrrr_u10', 'hrrr_v10'].includes(key))
                                                .map(([key, info]) => (
                                                    <label key={key}>
                                                        <input
                                                            type="checkbox"
                                                            checked={info.visible}
                                                            onChange={() => toggleOverlay(key)}
                                                        />
                                                        {info.label}
                                                    </label>
                                                ))}
                                        </div>

                                        <div id="hrrrptypeoverlays">
                                            {Object.entries(overlayState)
                                                .filter(([key]) => ['hrrr_rain', 'hrrr_snow', 'hrrr_icep', 'hrrr_frzr'].includes(key))
                                                .map(([key, info]) => (
                                                    <label key={key}>
                                                        <input
                                                            type="checkbox"
                                                            checked={info.visible}
                                                            onChange={() => toggleOverlay(key)}
                                                        />
                                                        {info.label}
                                                    </label>
                                                ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                    <div id="container">
                        <div id="mainbox">
                            <div id="metrics-display">
                                <ul style={{ listStyleType: 'none', paddingLeft: '5px', paddingRight: '5px', marginLeft:'0px' }}>
                                    <li>Freezing Energy (J/kg): {metrics?.cold_area || 'N/A'}</li>
                                    <li>Melting Energy (J/kg): {metrics?.warm_area || 'N/A'}</li>
                                    <li>Freeze Thickness (m): {metrics?.cold_thickness || 'N/A'}</li>
                                    <li>Melt Thickness (m): {metrics?.warm_thickness || 'N/A'}</li>
                                    <li>Upper Crossing (m AGL): {metrics?.highest_crossing || 'N/A'}</li>
                                    <li>Lower Crossing (m AGL): {metrics?.lowest_crossing || 'N/A'}</li>
                                    <li>Min Freeze Layer Temp (C): {metrics?.min_cold || 'N/A'}</li>
                                    <li>Max Melt Layer Temp (C): {metrics?.max_warm || 'N/A'}</li>
                                    <li>Surface Temperature (C): {metrics?.surface_temp || 'N/A'}</li>
                                </ul>
                            </div>
                            <label id="rhlock">
                                <input
                                    type="checkbox"
                                    checked={rhLock}
                                    onChange={handleRhLockChange}
                                />
                                Lock RH
                            </label>
                        </div>
                        <div id="warning">
                            <p id="warningtext">This sounding has been modified from the base state.</p>
                            <button id="resetButton">Reset</button>
                        </div>
                        <div id="barchart">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Home;
