import React, { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenerativeAI } from "@google/generative-ai";

const equipmentOptions = [
  { type: "Audio Interface", models: ["Scarlett 2i2 USB", "Apollo Twin X"] },
  { type: "Microphone", models: ["Shure SM7B", "Neumann TLM 103"] },
  { type: "MIDI Controller", models: ["Maschine MK3", "Arturia KeyLab"] },
  { type: "DAW", models: ["Logic Pro", "Ableton Live"] },
  { type: "Plugin", models: ["FabFilter Pro-Q 2", "bx_console SSL 4000 E", "CLA Vocals"] },
  { type: "Mixer", models: ["Audio Mixer (4ch)"] },
  { type: "Output", models: ["Scarlett 2i2 USB"] },
];

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "models/gemini-pro" });

export default function SetupMapper() {
  const [boxes, setBoxes] = useState([
    { id: uuidv4(), x: 100, y: 100, type: "Audio Interface", model: "Scarlett 2i2 USB", year: "2020" },
    { id: uuidv4(), x: 400, y: 100, type: "Plugin", model: "FabFilter Pro-Q 2", year: "2018" },
    { id: uuidv4(), x: 700, y: 100, type: "Plugin", model: "CLA Vocals", year: "2019" }
  ]);
  const [connections, setConnections] = useState([]);
  const [draggingWire, setDraggingWire] = useState(null);

  const addBox = () => {
    setBoxes([
      ...boxes,
      {
        id: uuidv4(),
        x: 100,
        y: 100,
        type: "",
        model: "",
        year: "",
      },
    ]);
  };

  const updateBox = (id, key, value) => {
    setBoxes(boxes.map((box) => (box.id === id ? { ...box, [key]: value } : box)));
  };

  const deleteBox = (id) => {
    setBoxes(boxes.filter((box) => box.id !== id));
    setConnections(connections.filter((conn) => conn.from.id !== id && conn.to.id !== id));
  };

  const handleDragStart = (e, id) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const box = boxes.find((b) => b.id === id);
    const offsetX = startX - box.x;
    const offsetY = startY - box.y;

    const handleMouseMove = (e) => {
      const newX = e.clientX - offsetX;
      const newY = e.clientY - offsetY;
      setBoxes((prev) =>
        prev.map((b) =>
          b.id === id ? { ...b, x: newX, y: newY } : b
        )
      );
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleCanvasClick = (targetBox) => {
    if (draggingWire && draggingWire.id !== targetBox.id) {
      setConnections([...connections, { from: draggingWire, to: targetBox }]);
      setDraggingWire(null);
    }
  };

  const analyzeSetup = async () => {
    const inputText = `Here is my studio setup configuration: ${JSON.stringify(boxes)}. Analyze this and suggest routing or setup optimizations.`;
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: inputText }] }],
    });
    const response = await result.response;
    const text = await response.text();
    alert(text);
  };

  const showLayout = () => {
    const layout = JSON.stringify(boxes, null, 2);
    alert(layout);
  };

  return (
    <div style={{ padding: "1rem" }}>
      <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "800px", zIndex: 0 }}>
        {boxes.map((fromBox, i) =>
          boxes.slice(i + 1).map((toBox) => (
            <g key={`${fromBox.id}-${toBox.id}`}>
              <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L10,5 L0,10 Z" fill="#007bff" />
                </marker>
              </defs>
              <line
                x1={fromBox.x + 125}
                y1={fromBox.y + 50}
                x2={toBox.x + 125}
                y2={toBox.y + 50}
                stroke="#007bff"
                strokeWidth="2"
                strokeDasharray="5,5"
                markerEnd="url(#arrow)"
              />
            </g>
          ))
        )}
        {connections.map((conn, idx) => (
          <line
            key={idx}
            x1={conn.from.x + 125}
            y1={conn.from.y + 50}
            x2={conn.to.x + 125}
            y2={conn.to.y + 50}
            stroke="#ff0000"
            strokeWidth="2"
            markerEnd="url(#arrow)"
          />
        ))}
      </svg>
      <button onClick={addBox} style={{ marginRight: "10px" }}>Add Device</button>
      <button onClick={analyzeSetup} style={{ marginRight: "10px" }}>Analyze Setup</button>
      <button onClick={showLayout} style={{ marginRight: "10px" }}>Show Layout</button>
      <button onClick={() => setDraggingWire(null)}>Cancel Wire</button>

      <div style={{ position: "relative", width: "100%", height: "800px", border: "1px solid #ccc", marginTop: "20px", zIndex: 1 }} onMouseUp={() => setDraggingWire(null)}>
        {boxes.map((box) => (
          <div onClick={() => handleCanvasClick(box)}
            key={box.id}
            style={{
              position: "absolute",
              left: box.x,
              top: box.y,
              width: "250px",
              padding: "10px",
              backgroundColor: "#f0f0f0",
              border: "1px solid #999",
              borderRadius: "8px",
              cursor: "move",
            }}
            onMouseDown={(e) => handleDragStart(e, box.id)} onDoubleClick={() => setDraggingWire(box)}
          >
            <div style={{ marginBottom: "10px" }}>
              <label>Type:</label>
              <select value={box.type} onChange={(e) => updateBox(box.id, "type", e.target.value)}>
                <option value="">Select Type</option>
                {equipmentOptions.map((opt) => (
                  <option key={opt.type} value={opt.type}>{opt.type}</option>
                ))}
              </select>
            </div>

            {box.type && (
              <div style={{ marginBottom: "10px" }}>
                <label>Model:</label>
                <select value={box.model} onChange={(e) => updateBox(box.id, "model", e.target.value)}>
                  <option value="">Select Model</option>
                  {equipmentOptions.find((e) => e.type === box.type)?.models.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </div>
            )}

            <input
              type="text"
              placeholder="Enter Year"
              style={{ width: "100%", padding: "5px" }}
              value={box.year}
              onChange={(e) => updateBox(box.id, "year", e.target.value)}
            />

            <button
              style={{ marginTop: "5px", backgroundColor: "#ffdddd", color: "red", border: "none", padding: "4px", width: "100%" }}
              onClick={() => deleteBox(box.id)}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}


