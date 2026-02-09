'use client'

const ColorPickerCell = (props: { cellData: string }) => {
  const { cellData } = props

  if (!cellData) return null
  return (
    <div className="chip" style={{ backgroundColor: cellData as string }} />
  )
}

export default ColorPickerCell
