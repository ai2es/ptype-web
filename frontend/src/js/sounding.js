import * as d3 from 'd3';

// Draw the skew-T background
export function drawBackground(m, w, h, basep, topp, plines, pticks, barbsize, tan, x, y) {
    const xAxis = d3.axisBottom(x).tickSize(0).ticks(10);
    const yAxis = d3.axisLeft(y).tickSize(0).tickValues(plines).tickFormat(d3.format(".0d"));
    const yAxis2 = d3.axisRight(y).tickSize(5).tickValues(pticks);

    const svg = d3.select("div#mainbox").append("svg")
        .attr("width", w + m[1] + m[3])
        .attr("height", h + m[0] + m[2])
        .attr("pointer-events", "all")
        .attr("id", "sounding-svg")
        .append("g")
        .attr("transform", `translate(${m[3]},${m[0]})`);

    svg.append("clipPath")
        .attr("id", "clipper")
        .append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", w)
        .attr("height", h);

    svg.selectAll("gline")
        .data(d3.range(-100, 45, 5))
        .enter().append("line")
        .attr("x1", d => x(d) - 0.5 + (y(basep) - y(topp)) / tan)
        .attr("x2", d => x(d) - 0.5)
        .attr("y1", 0)
        .attr("y2", h)
        .attr("class", d => d == 0 ? "tempzero" : "gridline")
        .attr("clip-path", "url(#clipper)");

    svg.append("g").attr("class", "x axis").attr("transform", `translate(0,${h - 0.5})`).call(xAxis);
    svg.append("g").attr("class", "y axis").attr("transform", "translate(-0.5,0)").call(yAxis);
    svg.append("g").attr("class", "y axis ticks").attr("transform", "translate(-0.5,0)").call(yAxis2);

    return svg;
}

// Fires at drag start
function dragStarted(event, d) {
    d.initialX = d.x;
}

// Fires while dragging
function dragged(event, d) {
    const group = d3.select(`#group-${d.type}-${d.idx}`);
    group.select("circle")
        .attr("cx", d.x = event.x)

    group.select("rect")
        .attr("x", d.type === 'temppath' ? d.x + 4 : d.x - 14)
}

// Fires after dragging completed
function dragEnded(event, d, w, h, basep, topp, tan, setTemp, temp, setMod, setOther, other, dtype, rhLock) {
    document.getElementById("barchart").style.border = "3px solid red";
    document.getElementById("warning").style.visibility = "visible";
    const idx = d.idx;

    const x = d3.scaleLinear().range([0, w]).domain([-35, 30]);
    const y = d3.scaleLog().range([0, h]).domain([topp, basep]);

    const initialX = d.initialX;
    const newX = d.x;
    const deltaTemp = x.invert(newX) - x.invert(initialX);

    const sigma = 2;
    const gaussian = (distance) => Math.exp(-0.5 * Math.pow(distance / sigma, 2));

    const newTempArray = temp.map((t, i) => {
        const distance = Math.abs(i - idx);
        const influence = gaussian(distance);
        return t + deltaTemp * influence;
    });

    // Check if relative humidity needs to be constant
    if (rhLock) {
        // Handling RH Lock logic...
        if (dtype === "temppath") {
            const origes = temp.map((origt, i) => {
                return 6.112 * Math.exp((17.67 * origt) / (origt + 243.5));
            });

            const orige = other.map((origd, i) => {
                return 6.112 * Math.exp((17.67 * origd) / (origd + 243.5));
            });

            const origrh = orige.map((vap, i) => {
                return vap / origes[i];
            });

            const newes = newTempArray.map((newt, i) => {
                return 6.112 * Math.exp((17.67 * newt) / (newt + 243.5));
            });

            const newe = newes.map((newsvap, i) => {
                return newsvap * origrh[i];
            });

            const newdpt = newe.map((newvap, i) => {
                var logTerm = Math.log(newvap / 6.112);
                return (-243.5 * logTerm) / (logTerm - 17.67);
            });

            setOther(newdpt);
        }
        if (dtype === "dptpath") {
            const origes = other.map((origt, i) => {
                return 6.112 * Math.exp((17.67 * origt) / (origt + 243.5));
            });

            const orige = temp.map((origd, i) => {
                return 6.112 * Math.exp((17.67 * origd) / (origd + 243.5));
            });

            const origrh = orige.map((vap, i) => {
                return vap / origes[i];
            });

            const newe = newTempArray.map((newd, i) => {
                return 6.112 * Math.exp((17.67 * newd) / (newd + 243.5));
            });

            const newes = newe.map((newvap, i) => {
                return newvap / origrh[i];
            });

            const newt = newes.map((newsvap, i) => {
                var logTerm = Math.log(newsvap / 6.112);
                return (-243.5 * logTerm) / (logTerm - 17.67);
            });

            setOther(newt);
        }
    }

    const ypres = y.invert(d.y);
    const newtemp = newTempArray[idx];
    const newCx = x(newtemp) + (y(1050) - y(ypres)) / tan;

    const group = d3.select(`#group-${d.type}-${idx}`);
    group.select("circle")
        .attr("cx", newCx)
        .attr("cy", d.y);

    group.select("rect")
        .attr("x", d.type === 'temppath' ? newCx + 4 : newCx - 14)
        .attr("y", d.y - 2); 
    setTemp(newTempArray);
    setMod(1);
}

// Draws new lines and dots given temp/dpt profiles
export function drawLinesDots(temp, pres, w, h, basep, topp, tan, svg, color, dtype, setTemp, selectedDate, selectedInitialization, sliderValue, setMod, setOther, other, rhLock) {
    const drag = d3.drag()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", function (event, d) {
            dragEnded.call(this, event, d, w, h, basep, topp, tan, setTemp, temp, setMod, setOther, other, dtype, rhLock);
        });

    const transformed = transform(temp, pres, w, h, basep, topp, tan);
    const transformedpres = transformed.map(pair => pair[0]);
    const transformedtemp = transformed.map(pair => pair[1]);

    if (dtype==="temppath") {
        var totalPositiveArea = 0;
        var totalNegativeArea = 0;
        var g = 9.81;  // Gravitational acceleration in m/s^2
        var dz = 250;  // Constant height difference in meters

        for (let i = 0; i < temp.length - 1; i++) {
            // Convert temperatures to Kelvin
            var t_0 = temp[i] + 273.15;
            var t_1 = temp[i + 1] + 273.15;

            // Calculate the average temperature between the two levels
            var t_avg = (t_0 + t_1) / 2;

            // Calculate the area contribution from this segment
            var area = g * ((t_avg - 273.15) / 273.15) * dz;

            // Accumulate the positive and negative areas
            if (area <= 0) {
                totalNegativeArea += area;
            } else {
                totalPositiveArea += area;
            }

        }

    }

    const lineGenerator = d3.line()
        .x(d => d[0])
        .y(d => d[1]);

    svg.append("path")
        .datum(transformed)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("id", dtype)
        .attr("d", lineGenerator);

    transformedpres.forEach((presValue, i) => {
        const tempValue = transformedtemp[i];

        const group = svg.append("g")
            .attr("id", `group-${dtype}-${i}`)
            .datum({ x: presValue, y: tempValue, idx: i, type: dtype })
            .call(drag);

        group.append("circle")
            .attr("cx", presValue)
            .attr("cy", tempValue)
            .attr("r", 4)
            .attr("fill", color)
            .attr("opacity", 0.7)
            .attr("id", `circle-${dtype}-${i}`)
            .on("mouseover", function () {
                d3.select(this).attr("r", 6).attr("opacity", 1);
            })
            .on("mouseout", function () {
                d3.select(this).attr("r", 4).attr("opacity", 0.7);
            });

        const handleX = dtype === 'temppath' ? presValue + 4 : presValue - 14;

        group.append("rect")
            .attr("class", "handle")
            .attr("x", handleX)
            .attr("y", tempValue - 2)
            .attr("width", 10)
            .attr("height", 4)
            .attr("fill", color)
            .attr("opacity", 0)
            .attr("id", `handle-${dtype}-${i}`)
            .on("mouseover", function () {
                d3.select(this).attr("opacity", 1);
            })
            .on("mouseout", function () {
                d3.select(this).attr("opacity", 0);
            });

    });
    svg.selectAll("g")
        .filter(function() {
            return this.id.startsWith('group-temppath');
        })
        .raise();
    svg.selectAll("g")
        .filter(function() {
            return this.id.startsWith('group-dptpath');
        }) 
        .raise();

    svg.select("#temppath").lower();
    svg.select("#dptpath").lower();
}

// Transforms from values to coordinates
export function transform(temp, pres, w, h, basep, topp, tan) {
    const x = d3.scaleLinear().range([0, w]).domain([-35, 30]);
    const y = d3.scaleLog().range([0, h]).domain([topp, basep]);
    return temp.map((e, idx) => [x(e) + (y(1050) - y(pres[idx])) / tan, y(pres[idx])]);
}

let xbar, ybar;


// Creates bar chart
export function createBar(rain, snow, icep, frzr, uncertainty) {
    const ptypedata = [
        { "name": "Uncertainty", "value": uncertainty, "color": "black"},
        { "name": "Freezing Rain", "value": frzr, "color": "purple" },
        { "name": "Sleet", "value": icep, "color": "red" },
        { "name": "Rain", "value": rain, "color": "green" },
        { "name": "Snow", "value": snow, "color": "blue" }
    ];

    const margin = { top: 5, right: 40, bottom: 5, left: 85 };
    const width = 400 - margin.left - margin.right;
    const height = 110 - margin.top - margin.bottom;

    xbar = d3.scaleLinear().range([0, width]).domain([0, 1]);  // Define xbar once
    ybar = d3.scaleBand().range([height, 0]).padding(0.1).domain(ptypedata.map(d => d.name));  // Define ybar once

    const barsvg = d3.select("#barchart").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .attr("id", "bar-svg")
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top+5})`);

    barsvg.append("g").attr("class", "y axis bar").call(d3.axisLeft(ybar).tickSize(0)).select("path").style("stroke", "black");

    const bars = barsvg.selectAll(".barGroup").data(ptypedata).enter().append("g").attr("class", "barGroup");

    bars.append("rect")
        .attr("class", "bar")
        .attr("y", d => ybar(d.name))
        .attr("height", ybar.bandwidth())
        .attr("x", 0)
        .attr("width", d => xbar(d.value))
        .attr("style", d => `fill: ${d.color};`);

    bars.append("text")
        .attr("class", "label")
        .attr("y", d => ybar(d.name) + ybar.bandwidth() / 2 + 4)
        .attr("x", d => xbar(d.value) + 3)
        .text(d => d.value)
        .style("fill", "black");

    return barsvg;
}

// Updates bar chart
export function updateBar(barsvg, rain, snow, icep, frzr, selectedDate, selectedInitialization, sliderValue, uncertainty) {
    const ptypedata = [
        { "name": "Uncertainty", "value": uncertainty, "color": "black" },
        { "name": "Freezing Rain", "value": frzr, "color": "rgb(177,0,0)" },
        { "name": "Sleet", "value": icep, "color": "rgb(79,59,133)" },
        { "name": "Rain", "value": rain, "color": "rgb(0,108,38)" },
        { "name": "Snow", "value": snow, "color": "rgb(0,79,146)" }
    ];

    barsvg.selectAll(".barGroup").remove();  // Remove previous bars

    const bars = barsvg.selectAll(".barGroup").data(ptypedata).enter().append("g").attr("class", "barGroup");

    bars.append("rect")
        .attr("class", "bar")
        .attr("y", d => ybar(d.name))
        .attr("height", ybar.bandwidth())
        .attr("x", 0)
        .attr("width", d => xbar(d.value))
        .attr("style", d => `fill: ${d.color};`);

    bars.append("text")
        .attr("class", "label")
        .attr("y", d => ybar(d.name) + ybar.bandwidth() / 2 + 4)
        .attr("x", d => xbar(d.value) + 3)
        .text(d => d.value)
        .style("fill", "black");
}
