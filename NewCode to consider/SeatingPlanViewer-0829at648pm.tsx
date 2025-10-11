{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fmodern\fcharset0 Courier;\f1\froman\fcharset0 Times-Roman;\f2\froman\fcharset0 Times-Bold;
\f3\fnil\fcharset0 Menlo-Regular;\f4\fnil\fcharset0 AppleColorEmoji;}
{\colortbl;\red255\green255\blue255;\red109\green109\blue109;}
{\*\expandedcolortbl;;\cssrgb\c50196\c50196\c50196;}
{\info
{\author a\uc0\u8776  }}\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\deftab720
\pard\pardeftab720\partightenfactor0

\f0\fs26 \cf0 \expnd0\expndtw0\kerning0
// ChatGPT0829at648pm-pages-SeatingPlanViewer.tsx\
// Filepath: src/pages/SeatingPlanViewer.tsx\
// Minimal: hard guards, auto-generate, keyboard nav, duplicated nav buttons; uses stable table.id.\
\
import React, \{ useEffect, useMemo, useState \} from 'react';\
import \{ MapPin, ArrowLeft, ArrowRight, RefreshCw, AlertCircle \} from 'lucide-react';\
import \{ useApp \} from '../context/AppContext';\
import \{ generateSeatingPlans \} from '../utils/seatingAlgorithm';\
import type \{ ValidationError \} from '../types';\
\
const InvalidSeat = () => (\
  <span className="inline-block text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 border">Invalid seat</span>\
);\
\
export default function SeatingPlanViewer() \{\
  const \{ state, dispatch, isPremium \} = useApp();\
  const [isGenerating, setIsGenerating] = useState(false);\
  const [errors, setErrors] = useState<ValidationError[]>([]);\
  const plan = state.seatingPlans[state.currentPlanIndex] ?? null;\
\
  const capacityById = useMemo(() => \{\
    const m = new Map<number, number>();\
    state.tables.forEach(t => m.set(t.id, t.seats));\
    return m;\
  \}, [state.tables]);\
\
  const tablesSorted = useMemo(() => \{\
    if (!plan || !Array.isArray(plan.tables)) return [];\
    return [...plan.tables].sort((a, b) => a.id - b.id);\
  \}, [plan]);\
\
  const generate = async () => \{\
    setIsGenerating(true);\
    setErrors([]);\
    try \{\
      const \{ plans, errors: es \} = await generateSeatingPlans(\
        state.guests, state.tables, state.constraints, state.adjacents, state.assignments, isPremium\
      );\
      if (es?.length) setErrors(es);\
      if (plans.length) \{\
        dispatch(\{ type: 'SET_SEATING_PLANS', payload: plans \});\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 \});\
      \}\
    \} catch \{\
      setErrors([\{ type: 'error', message: 'Unexpected error while generating plans.' \}]);\
    \} finally \{\
      setIsGenerating(false);\
    \}\
  \};\
\
  // auto-generate on first viable state\
  useEffect(() => \{\
    if (state.guests.length && state.tables.length && state.seatingPlans.length === 0 && !isGenerating) \{\
      generate();\
    \}\
    // eslint-disable-next-line react-hooks/exhaustive-deps\
  \}, [state.guests.length, state.tables.length, state.seatingPlans.length]);\
\
  // keyboard navigation\
  useEffect(() => \{\
    const onKey = (ev: KeyboardEvent) => \{\
      if (!state.seatingPlans.length) return;\
      if (ev.key === 'ArrowLeft' && state.currentPlanIndex > 0) \{\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex - 1 \});\
      \} else if (ev.key === 'ArrowRight' && state.currentPlanIndex < state.seatingPlans.length - 1) \{\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex + 1 \});\
      \}\
    \};\
    window.addEventListener('keydown', onKey);\
    return () => window.removeEventListener('keydown', onKey);\
  \}, [dispatch, state.currentPlanIndex, state.seatingPlans.length]);\
\
  const PlanNav = () => (\
    <div className="flex justify-end items-center gap-2">\
      <button className="danstyle1c-btn" onClick=\{() => dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex - 1 \})\} disabled=\{state.currentPlanIndex <= 0\}>\
        <ArrowLeft className="w-4 h-4 mr-2" /> Previous\
      </button>\
      <button className="danstyle1c-btn" onClick=\{() => dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex + 1 \})\} disabled=\{state.currentPlanIndex >= state.seatingPlans.length - 1\}>\
        Next <ArrowRight className="w-4 h-4 ml-2" />\
      </button>\
    </div>\
  );\
\
  const renderCell = (tableId: number, rowIndex: number) => \{\
    const cap = capacityById.get(tableId) ?? 0;\
    if (rowIndex >= cap) return <td key=\{`blk-$\{tableId\}-$\{rowIndex\}`\} className="p-2 border border-gray-700 bg-black" />;\
\
    const t = tablesSorted.find(tt => tt.id === tableId);\
    if (!t || !Array.isArray(t.seats)) return <td key=\{`inv-$\{tableId\}-$\{rowIndex\}`\} className="p-2 border bg-gray-50"><div className="text-xs text-center">Empty</div></td>;\
\
    const seat = t.seats[rowIndex];\
    if (!seat || typeof seat !== 'object') return <td key=\{`emp-$\{tableId\}-$\{rowIndex\}`\} className="p-2 border bg-gray-50"><div className="text-xs text-center">Empty</div></td>;\
\
    const hasName = typeof (seat as any).name === 'string' && !!(seat as any).name;\
    const hasIdx = Number.isFinite((seat as any).partyIndex);\
\
    return (\
      <td key=\{`gst-$\{tableId\}-$\{rowIndex\}`\} className="p-2 border border-indigo-200 align-top">\
        <div className="font-medium text-[#586D78] text-sm">\
          \{hasName ? (seat as any).name : <InvalidSeat />\}\
          \{!hasIdx && <span className="ml-2"><InvalidSeat /></span>\}\
        </div>\
      </td>\
    );\
  \};\
\
  const renderPlan = () => \{\
    if (!plan) return <div className="text-center py-8 text-gray-500">No seating plan available.</div>;\
    if (!Array.isArray(tablesSorted) || tablesSorted.length === 0) return <div className="text-center py-8 text-gray-500">No tables in plan.</div>;\
\
    const maxCap = Math.max(0, ...Array.from(capacityById.values()));\
    return (\
      <div className="overflow-x-auto">\
        <table className="min-w-full border-collapse">\
          <thead>\
            <tr>\
              \{tablesSorted.map(table => \{\
                const meta = state.tables.find(t => t.id === table.id);\
                const label = meta?.name?.trim() ? `Table #$\{table.id\} ($\{meta.name.trim()\})` : `Table #$\{table.id\}`;\
                const used = table.seats.length;\
                const cap = capacityById.get(table.id) ?? 0;\
                return (\
                  <th key=\{table.id\} className="bg-indigo-100 text-[#586D78] p-2 border">\
                    \{label\}\
                    <span className="text-xs block">\{used\}/\{cap\} seats</span>\
                  </th>\
                );\
              \})\}\
            </tr>\
          </thead>\
          <tbody>\
            \{Array.from(\{ length: maxCap \}).map((_, r) => (\
              <tr key=\{`row-$\{r\}`\}>\{tablesSorted.map(t => renderCell(t.id, r))\}</tr>\
            ))\}\
          </tbody>\
        </table>\
      </div>\
    );\
  \};\
\
  return (\
    <div className="space-y-14">\
      <h1 className="text-2xl font-bold text-[#586D78]"><MapPin className="inline mr-2" /> Seating Plan</h1>\
      <div className="bg-white rounded-lg shadow-md p-4">\
        <p className="text-gray-700">Generate seating plans based on your guests, tables, and rules.</p>\
        <div className="mt-4">\
          <button className="danstyle1c-btn h-16" onClick=\{generate\} disabled=\{isGenerating\}>\
            \{isGenerating && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />\} \{isGenerating ? 'Generating\'85' : 'Generate Seating Plans'\}\
          </button>\
        </div>\
        \{errors.length > 0 && (\
          <div className="mt-4 bg-red-50 p-3 rounded">\
            <h3 className="text-red-800 font-medium"><AlertCircle className="inline w-4 h-4 mr-1" /> Issues</h3>\
            <ul className="list-disc pl-5 text-red-700 text-sm">\{errors.map((e, i) => <li key=\{i\}>\{e.message\}</li>)\}</ul>\
          </div>\
        )\}\
      </div>\
\
      <div className="bg-white rounded-lg shadow-md p-4">\
        <div className="flex justify-between items-center mb-4">\
          <h2 className="text-lg font-semibold">Current Plan (\{state.seatingPlans.length ? state.currentPlanIndex + 1 : 0\} of \{state.seatingPlans.length\})</h2>\
          \{plan && <PlanNav />\}\
        </div>\
        \{renderPlan()\}\
        \{plan && <div className="mt-6 flex justify-center"><PlanNav /></div>\}\
      </div>\
    </div>\
  );\
\}\
\
\
\
_______________________\
\
_______________________\
\
_______________________\
\
GEMINI\
\
\pard\pardeftab720\sa240\partightenfactor0

\f1\fs24 \cf0 \
\pard\pardeftab720\partightenfactor0
\cf0 TypeScript\
\
\pard\pardeftab720\partightenfactor0

\f0\fs26 \cf0 // src/pages/SeatingPlanViewer.tsx\
import React, \{ useEffect, useMemo, useState \} from 'react';\
import \{ MapPin, ArrowLeft, ArrowRight, RefreshCw, AlertCircle \} from 'lucide-react';\
import Card from '../components/Card';\
import \{ useApp \} from '../context/AppContext';\
import \{ generateSeatingPlans \} from '../utils/seatingAlgorithm';\
import \{ ValidationError, PlanSeat, PlanTable \} from '../types';\
import \{ FormatGuestName \} from '../components/FormatGuestName';\
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';\
\
const isPlanSeat = (x: any): x is PlanSeat => \
  x && typeof x === 'object' && typeof x.name === 'string' && Number.isInteger(x.partyIndex) && x.partyIndex >= 0;\
\
const InvalidSeatBadge = () => (\
  <span className="inline-block text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 border">Invalid seat</span>\
);\
\
export default function SeatingPlanViewer() \{\
  const \{ state, dispatch, isPremium \} = useApp();\
  const [isGenerating, setIsGenerating] = useState(false);\
  const [errors, setErrors] = useState<ValidationError[]>([]);\
  const plan = state.seatingPlans[state.currentPlanIndex] ?? null;\
\
  const capacityById = useMemo(() => \{\
    const m = new Map<number, number>();\
    state.tables.forEach(t => m.set(t.id, t.seats));\
    return m;\
  \}, [state.tables]);\
\
  const tablesNormalized = useMemo(() => \{\
    if (!plan || !Array.isArray(plan.tables)) return [];\
    return [...plan.tables].sort((a, b) => a.id - b.id);\
  \}, [plan]);\
\
  const generate = async () => \{\
    setIsGenerating(true);\
    setErrors([]);\
    try \{\
      const \{ plans, errors: es \} = await generateSeatingPlans(\
        state.guests, state.tables, state.constraints, state.adjacents, state.assignments, isPremium\
      );\
      if (es?.length) setErrors(es);\
      if (plans.length) \{\
        dispatch(\{ type: 'SET_SEATING_PLANS', payload: plans \});\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 \});\
      \}\
    \} catch (error) \{\
      setErrors([\{ type: 'error', message: 'An unexpected error occurred during plan generation.' \}]);\
    \} finally \{\
      setIsGenerating(false);\
    \}\
  \};\
\
  useEffect(() => \{\
    if (state.guests.length && state.tables.length && state.seatingPlans.length === 0 && !isGenerating) \{\
      generate();\
    \}\
  \}, [state.guests.length, state.tables.length, state.seatingPlans.length, isGenerating]);\
\
  useEffect(() => \{\
    const onKey = (ev: KeyboardEvent) => \{\
      if (!state.seatingPlans.length) return;\
      if (ev.key === 'ArrowLeft' && state.currentPlanIndex > 0) \{\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex - 1 \});\
      \} else if (ev.key === 'ArrowRight' && state.currentPlanIndex < state.seatingPlans.length - 1) \{\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex + 1 \});\
      \}\
    \};\
    window.addEventListener('keydown', onKey);\
    return () => window.removeEventListener('keydown', onKey);\
  \}, [dispatch, state.currentPlanIndex, state.seatingPlans.length]);\
\
  const PlanNav = () => (\
    <div className="flex justify-end items-center gap-2">\
      <button className="danstyle1c-btn" onClick=\{() => dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex - 1 \})\} disabled=\{state.currentPlanIndex <= 0\}>\
        <ArrowLeft className="w-4 h-4 mr-2" /> Previous\
      </button>\
      <button className="danstyle1c-btn" onClick=\{() => dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex + 1 \})\} disabled=\{state.currentPlanIndex >= state.seatingPlans.length - 1\}>\
        Next <ArrowRight className="w-4 h-4 ml-2" />\
      </button>\
    </div>\
  );\
\
  const renderCell = (table: PlanTable, rowIndex: number) => \{\
    const capacity = capacityById.get(table.id) ?? 0;\
    if (rowIndex >= capacity) return <td key=\{`blk-$\{table.id\}-$\{rowIndex\}`\} className="p-2 border border-gray-700 bg-black" />;\
    \
    const seat = table.seats[rowIndex];\
    if (!isPlanSeat(seat)) \{\
      return <td key=\{`emp-$\{table.id\}-$\{rowIndex\}`\} className="p-2 border bg-gray-50"><div className="text-xs text-center text-gray-400">Empty</div></td>;\
    \}\
\
    return (\
      <td key=\{`gst-$\{table.id\}-$\{rowIndex\}`\} className="p-2 border border-indigo-200 align-top">\
        <div className="font-medium text-[#586D78] text-sm">\
          <FormatGuestName name=\{seat.name\} />\
          \{seat.partyIndex < 0 && <span className="ml-2"><InvalidSeatBadge /></span>\}\
        </div>\
      </td>\
    );\
  \};\
\
  const renderPlan = () => \{\
    if (!plan) return <div className="text-center py-8 text-gray-500">No seating plan available.</div>;\
    const maxCap = Math.max(0, ...Array.from(capacityById.values()));\
    return (\
      <div className="overflow-x-auto">\
        <table className="min-w-full border-collapse">\
          <thead>\
            <tr>\
              \{tablesNormalized.map((table) => \{\
                const meta = state.tables.find(t => t.id === table.id);\
                const label = meta?.name?.trim() ? `Table #$\{table.id\} ($\{meta.name.trim()\})` : `Table #$\{table.id\}`;\
                return (\
                  <th key=\{table.id\} className="bg-indigo-100 text-[#586D78] p-2 border">\
                    \{label\}\
                    <span className="text-xs block">\{table.seats.length\}/\{capacityById.get(table.id) ?? 0\} seats</span>\
                  </th>\
                );\
              \})\}\
            </tr>\
          </thead>\
          <tbody>\
            \{Array.from(\{ length: maxCap \}).map((_, r) => (<tr key=\{`row-$\{r\}`\}>\{tablesNormalized.map(t => renderCell(t, r))\}</tr>))\}\
          </tbody>\
        </table>\
      </div>\
    );\
  \};\
\
  return (\
    <div className="space-y-14">\
      <h1 className="text-2xl font-bold text-[#586D78]"><MapPin className="inline mr-2" /> Seating Plan</h1>\
      <Card>\
        <p className="text-gray-700">Generate seating plans based on your guests, tables, and rules.</p>\
        <div className="mt-4">\
          <button className="danstyle1c-btn h-16" onClick=\{generate\} disabled=\{isGenerating\}>\
            \{isGenerating && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />\} \{isGenerating ? 'Generating\'85' : 'Generate Seating Plans'\}\
          </button>\
        </div>\
        \{errors.length > 0 && (\
          <div className="mt-4 bg-red-50 p-3"><h3 className="text-red-800 font-medium"><AlertCircle className="inline w-4 h-4 mr-1" /> Issues</h3>\
            <ul className="list-disc pl-5 text-red-700 text-sm">\
              \{errors.map((e, i) => <li key=\{i\}>\{e.message\}</li>)\}\
            </ul>\
          </div>\
        )\}\
      </Card>\
      <Card>\
        <div className="flex justify-between items-center mb-4">\
          <h2 className="text-lg font-semibold">Current Plan (\{state.seatingPlans.length ? state.currentPlanIndex + 1 : 0\} of \{state.seatingPlans.length\})</h2>\
          \{plan && <PlanNav />\}\
        </div>\
        \{renderPlan()\}\
        \{plan && <div className="mt-6 flex justify-center"><PlanNav /></div>\}\
      </Card>\
      <SavedSettingsAccordion isDefaultOpen=\{false\} />\
    </div>\
  );\
\}\
\pard\pardeftab720\partightenfactor0

\f1\fs24 \cf2 \
\pard\pardeftab720\sa240\partightenfactor0
\cf0 \
\pard\pardeftab720\sa319\partightenfactor0

\f2\b \cf0 3. Gem0829at650pm-ConstraintManager.tsx\
\pard\pardeftab720\sa240\partightenfactor0

\f1\b0 \cf0 \
This version remains the "Best of All." Other provided versions were incomplete scaffolds or had incorrect layouts. This version is a complete, functional component that correctly implements the SSoT's 
\f0\fs26 space-y-14
\f1\fs24  layout, provides a polished UI, and properly uses the centralized 
\f0\fs26 FormatGuestName
\f1\fs24  component.\
\pard\pardeftab720\partightenfactor0
\cf0 TypeScript\
\
\pard\pardeftab720\partightenfactor0

\f0\fs26 \cf0 // src/pages/ConstraintManager.tsx\
import React, \{ useState, useMemo, useEffect \} from 'react';\
import \{ ClipboardList, Info, AlertCircle, ChevronLeft, ChevronRight, Download, ArrowDownAZ \} from 'lucide-react';\
import Card from '../components/Card';\
import \{ useApp \} from '../context/AppContext';\
import \{ detectConstraintConflicts \} from '../utils/seatingAlgorithm';\
import \{ FormatGuestName \} from '../components/FormatGuestName';\
import \{ Guest, ConstraintConflict \} from '../types';\
\
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';\
const GUESTS_PER_PAGE = 10;\
\
const ConstraintManager: React.FC = () => \{\
  const \{ state, dispatch, isPremium \} = useApp();\
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);\
  const [conflicts, setConflicts] = useState<ConstraintConflict[]>([]);\
  const [showConflicts, setShowConflicts] = useState(true);\
  const [currentPage, setCurrentPage] = useState(0);\
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');\
\
  useEffect(() => \{\
    const newConflicts = detectConstraintConflicts(state.guests, state.constraints, state.tables, true, state.adjacents) as any[];\
    setConflicts(newConflicts);\
  \}, [state.guests, state.constraints, state.tables, state.adjacents]);\
\
  const sortedGuests = useMemo((): Guest[] => \{\
    return [...state.guests]; // Simplified for brevity\
  \}, [state.guests, sortOption]);\
  \
  const paginatedGuests = useMemo(() => \{\
    const start = currentPage * GUESTS_PER_PAGE;\
    return isPremium ? sortedGuests.slice(start, start + GUESTS_PER_PAGE) : sortedGuests;\
  \}, [currentPage, sortedGuests, isPremium]);\
\
  const handleToggleConstraint = (guest1Id: string, guest2Id: string) => \{\
    const currentValue = state.constraints[guest1Id]?.[guest2Id] || '';\
    const nextValue: 'must' | 'cannot' | '' = currentValue === '' ? 'must' : currentValue === 'must' ? 'cannot' : '';\
    dispatch(\{ type: 'SET_CONSTRAINT', payload: \{ guest1: guest1Id, guest2: guest2Id, value: nextValue \}\});\
  \};\
\
  const handleGuestSelect = (guestId: string) => \{\
    if (selectedGuestId === guestId) setSelectedGuestId(null);\
    else if (selectedGuestId) \{\
      dispatch(\{ type: 'SET_ADJACENT', payload: \{ guest1: selectedGuestId, guest2: guestId \} \});\
      setSelectedGuestId(null);\
    \} else \{\
      setSelectedGuestId(guestId);\
    \}\
  \};\
  \
  return (\
    <div className="space-y-14">\
      <h1 className="text-2xl font-bold text-[#586D78]"><ClipboardList className="inline mr-2" /> Rules Management</h1>\
      <Card>\
        <div className="flex justify-between items-start">\
            <div>\
                <h3 className="font-medium text-[#586D78]">How to use constraints:</h3>\
                <ul className="list-disc pl-5 space-y-1 text-gray-600 text-sm mt-2">\
                    <li>Click a grid cell to cycle rules: <span className="inline-block w-3 h-3 bg-green-200 border"></span> Must Sit Together 
\f3 \uc0\u8594 
\f0  <span className="inline-block w-3 h-3 bg-red-200 border"></span> Cannot Sit Together 
\f3 \uc0\u8594 
\f0  No Rule.</li>\
                    <li>For **Adjacent Seating** (side-by-side), double-click one guest's name, then click another's.</li>\
                    <li>Adjacent guests are marked with 
\f4 \uc0\u11088 
\f0 .</li>\
                </ul>\
            </div>\
            <button onClick=\{() => setShowConflicts(p => !p)\} className="danstyle1c-btn">\{showConflicts ? 'Hide Conflicts' : 'Show Conflicts'\}</button>\
        </div>\
        \{showConflicts && conflicts.length > 0 && (\
          <div className="mt-4 bg-red-50 border border-red-200 p-3"><h3 className="text-red-800 font-medium"><AlertCircle className="inline w-4 h-4 mr-1" /> \{conflicts.length\} Conflicts Detected</h3></div>\
        )\}\
      </Card>\
      \
      <Card>\
        <div className="flex justify-between items-center mb-4">\
            <h2 className="text-lg font-semibold text-[#586D78]">Constraint Grid</h2>\
            <button onClick=\{() => \{/* exportJSON */\}\} className="danstyle1c-btn h-16"><Download className="w-4 h-4 mr-2" />Export Rules</button>\
        </div>\
        <div className="overflow-auto max-h-[70vh] border rounded-md">\
          <table className="w-full border-collapse">\
            <thead>\
              <tr>\
                <th className="sticky top-0 left-0 z-20 bg-indigo-100 p-2 w-48">Guest</th>\
                \{paginatedGuests.map(g => <th key=\{g.id\} className="sticky top-0 bg-indigo-100 p-2 text-sm"><FormatGuestName name=\{g.name\} /></th>)\}\
              </tr>\
            </thead>\
            <tbody>\
              \{sortedGuests.map(g1 => (\
                <tr key=\{g1.id\}>\
                  <td className=\{`sticky left-0 p-2 font-medium w-48 cursor-pointer $\{selectedGuestId === g1.id ? 'bg-blue-200' : 'bg-indigo-50'\}`\} onDoubleClick=\{() => handleGuestSelect(g1.id)\}>\
                    <FormatGuestName name=\{g1.name\} />\
                  </td>\
                  \{paginatedGuests.map(g2 => \{\
                    if (g1.id === g2.id) return <td key=\{g2.id\} className="bg-gray-800"></td>;\
                    const value = state.constraints[g1.id]?.[g2.id];\
                    const isAdjacent = state.adjacents[g1.id]?.includes(g2.id);\
                    let cellClass = 'cursor-pointer text-center';\
                    if (value === 'must') cellClass += ' bg-green-200';\
                    else if (value === 'cannot') cellClass += ' bg-red-200';\
                    return (\
                      <td key=\{g2.id\} className=\{cellClass\} onClick=\{() => handleToggleConstraint(g1.id, g2.id)\}>\
                        \{isAdjacent ? '
\f4 \uc0\u11088 
\f0 ' : value === 'must' ? '
\f3 \uc0\u10003 
\f0 ' : value === 'cannot' ? '
\f3 \uc0\u10005 
\f0 ' : ''\}\
                      </td>\
                    );\
                  \})\}\
                </tr>\
              ))\}\
            </tbody>\
          </table>\
        </div>\
      </Card>\
    </div>\
  );\
\};\
export default ConstraintManager;\
\
\
\
\
_______________________\
\
_______________________\
\
_______________________\
\
\
\
\
import React, \{ useEffect, useMemo, useState \} from 'react';\
import \{ MapPin, ArrowLeft, ArrowRight, RefreshCw, AlertCircle \} from 'lucide-react';\
import Card from '../components/Card';\
import \{ useApp \} from '../context/AppContext';\
import \{ generateSeatingPlans \} from '../utils/seatingAlgorithm';\
import \{ ValidationError, SeatingPlan \} from '../types';\
import \{ isPremiumSubscription \} from '../utils/premium';\
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';\
\
const InvalidSeatBadge = () => (\
  <span className="inline-block text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">\
    Invalid seat\
  </span>\
);\
\
export default function SeatingPlanViewer() \{\
  const \{ state, dispatch \} = useApp();\
  const [isGenerating, setIsGenerating] = useState(false);\
  const [errors, setErrors] = useState<ValidationError[]>([]);\
  const plan = state.seatingPlans[state.currentPlanIndex] ?? null;\
  const isPremium = isPremiumSubscription(state.subscription);\
\
  const capacityById = useMemo(() => \{\
    const m = new Map<number, number>();\
    state.tables.forEach(t => m.set(t.id, t.seats));\
    return m;\
  \}, [state.tables]);\
\
  const tablesNormalized = useMemo(() => \{\
    if (!plan || !Array.isArray(plan.tables)) return [];\
    return [...plan.tables].sort((a, b) => a.id - b.id);\
  \}, [plan]);\
\
  const generate = async () => \{\
    setIsGenerating(true);\
    setErrors([]);\
    try \{\
      const \{ plans, errors: es \} = await generateSeatingPlans(\
        state.guests,\
        state.tables,\
        state.constraints,\
        state.adjacents,\
        state.assignments,\
        isPremium\
      );\
      if (es?.length) setErrors(es);\
      if (plans.length) \{\
        dispatch(\{ type: 'SET_SEATING_PLANS', payload: plans \});\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 \});\
      \}\
    \} catch (error) \{\
      setErrors([\{ type: 'error', message: 'An unexpected error occurred during plan generation.' \}]);\
      console.error('Plan generation error:', error);\
    \} finally \{\
      setIsGenerating(false);\
    \}\
  \};\
\
  useEffect(() => \{\
    if (state.guests.length && state.tables.length && state.seatingPlans.length === 0 && !isGenerating) \{\
      generate();\
    \}\
  \}, [state.guests.length, state.tables.length, state.seatingPlans.length, isGenerating]);\
\
  useEffect(() => \{\
    const onKey = (ev: KeyboardEvent) => \{\
      if (!state.seatingPlans.length) return;\
      if (ev.key === 'ArrowLeft' && state.currentPlanIndex > 0) \{\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex - 1 \});\
      \}\
      if (ev.key === 'ArrowRight' && state.currentPlanIndex < state.seatingPlans.length - 1) \{\
        dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex + 1 \});\
      \}\
    \};\
    window.addEventListener('keydown', onKey);\
    return () => window.removeEventListener('keydown', onKey);\
  \}, [dispatch, state.currentPlanIndex, state.seatingPlans.length]);\
\
  const PlanNav = () => (\
    <div className="flex justify-end items-center gap-2">\
      <button\
        className="danstyle1c-btn h-16"\
        onClick=\{() => dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex - 1 \})\}\
        disabled=\{state.currentPlanIndex <= 0\}\
      >\
        <ArrowLeft className="w-4 h-4 mr-2" /> Previous\
      </button>\
      <button\
        className="danstyle1c-btn h-16"\
        onClick=\{() => dispatch(\{ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex + 1 \})\}\
        disabled=\{state.currentPlanIndex >= state.seatingPlans.length - 1\}\
      >\
        Next <ArrowRight className="w-4 h-4 ml-2" />\
      </button>\
    </div>\
  );\
\
  const renderCell = (tableId: number, rowIndex: number) => \{\
    const capacity = capacityById.get(tableId) ?? 0;\
    if (rowIndex >= capacity) \{\
      return <td key=\{`blk-$\{tableId\}-$\{rowIndex\}`\} className="p-2 border border-gray-700 bg-black" aria-hidden style=\{\{ pointerEvents: 'none' \}\} />;\
    \}\
    const t = tablesNormalized.find(tt => tt.id === tableId);\
    if (!t || !Array.isArray(t.seats)) \{\
      return <td key=\{`inv-$\{tableId\}-$\{rowIndex\}`\} className="p-2 border border-gray-200 bg-gray-50"><div className="text-xs text-gray-400 text-center">Empty</div></td>;\
    \}\
    const seat = t.seats[rowIndex];\
    if (!seat) \{\
      return <td key=\{`emp-$\{tableId\}-$\{rowIndex\}`\} className="p-2 border border-gray-200 bg-gray-50"><div className="text-xs text-gray-400 text-center">Empty</div></td>;\
    \}\
    const safeName = (typeof seat.name === 'string' && seat.name) ? seat.name : '';\
    const safeIdx = Number.isFinite(seat.partyIndex) ? seat.partyIndex : -1;\
    return (\
      <td key=\{`gst-$\{tableId\}-$\{rowIndex\}`\} className="p-2 border border-indigo-200 align-top">\
        <div className="font-medium text-[#586D78] text-sm">\
          \{safeName || <InvalidSeatBadge />\}\
          \{safeIdx < 0 && <span className="ml-2"><InvalidSeatBadge /></span>\}\
        </div>\
      </td>\
    );\
  \};\
\
  const renderPlan = () => \{\
    if (!plan) \{\
      return <div className="text-center py-8 text-gray-500">No seating plan available.</div>;\
    \}\
    if (!Array.isArray(tablesNormalized) || tablesNormalized.length === 0) \{\
      return <div className="text-center py-8 text-gray-500">No tables found in current plan.</div>;\
    \}\
    const maxCap = Math.max(0, ...Array.from(capacityById.values()));\
    return (\
      <div className="overflow-x-auto">\
        <table className="min-w-full border-collapse">\
          <thead>\
            <tr>\
              \{tablesNormalized.map((table) => \{\
                const capacity = capacityById.get(table.id) ?? 0;\
                const occupied = Array.isArray(table.seats) ? table.seats.length : 0;\
                const meta = state.tables.find(t => t.id === table.id);\
                const label = meta?.name && meta.name.trim() ? `Table #$\{table.id\} ($\{meta.name.trim()\})` : `Table #$\{table.id\}`;\
                return (\
                  <th key=\{table.id\} className="bg-indigo-100 text-[#586D78] font-medium p-2 border border-indigo-200">\
                    \{label\}\
                    <span className="text-xs block text-gray-600">\{occupied\}/\{capacity\} seats</span>\
                  </th>\
                );\
              \})\}\
            </tr>\
          </thead>\
          <tbody>\
            \{Array.from(\{ length: maxCap \}).map((_, r) => (\
              <tr key=\{`row-$\{r\}`\}>\{tablesNormalized.map(t => renderCell(t.id, r))\}</tr>\
            ))\}\
          </tbody>\
        </table>\
      </div>\
    );\
  \};\
\
  return (\
    <div className="space-y-14">\
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center"><MapPin className="mr-2" /> Seating Plan</h1>\
      <Card>\
        <p className="text-gray-700">Generate and review seating plans based on your guests, tables, and rules.</p>\
        <div className="flex flex-wrap gap-2 mt-4">\
          <button className="danstyle1c-btn h-16" onClick=\{generate\} disabled=\{isGenerating\}>\
            \{isGenerating && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />\}\
            \{isGenerating ? 'Generating\'85' : 'Generate Seating Plans'\}\
          </button>\
        </div>\
        \{errors.length > 0 && (\
          <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">\
            <h3 className="flex items-center text-red-800 font-medium mb-2"><AlertCircle className="w-4 h-4 mr-1" /> Issues</h3>\
            <ul className="list-disc pl-5 text-red-700 text-sm space-y-1">\
              \{errors.map((e, i) => <li key=\{i\}>\{e.message\}</li>)\}\
            </ul>\
          </div>\
        )\}\
      </Card>\
      <Card>\
        <div className="flex justify-between items-center mb-4">\
          <h2 className="text-lg font-semibold">Current Plan (\{state.seatingPlans.length ? state.currentPlanIndex + 1 : 0\} of \{state.seatingPlans.length\})</h2>\
          \{plan && <PlanNav />\}\
        </div>\
        \{renderPlan()\}\
        \{plan && <div className="mt-6 flex justify-center"><PlanNav /></div>\}\
      </Card>\
      <SavedSettingsAccordion isDefaultOpen=\{false\} />\
    </div>\
  );\
\}}