import AppKit

struct Palette {
    static let backgroundTop = NSColor(calibratedRed: 0.07, green: 0.25, blue: 0.40, alpha: 1.0)
    static let backgroundBottom = NSColor(calibratedRed: 0.05, green: 0.55, blue: 0.46, alpha: 1.0)
    static let highlight = NSColor(calibratedRed: 0.30, green: 0.75, blue: 0.78, alpha: 0.22)
    static let page = NSColor(calibratedWhite: 0.99, alpha: 1.0)
    static let pageShade = NSColor(calibratedWhite: 0.90, alpha: 1.0)
    static let ribbon = NSColor(calibratedRed: 1.00, green: 0.69, blue: 0.25, alpha: 1.0)
    static let ribbonShadow = NSColor(calibratedRed: 0.89, green: 0.46, blue: 0.12, alpha: 1.0)
    static let accent = NSColor(calibratedRed: 0.40, green: 0.91, blue: 0.86, alpha: 1.0)
}

func drawRoundedRect(_ rect: CGRect, radius: CGFloat) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    path.fill()
}

func drawBookPage(in context: CGContext, rect: CGRect, rotation: CGFloat, shadowAlpha: CGFloat) {
    context.saveGState()

    let center = CGPoint(x: rect.midX, y: rect.midY)
    context.translateBy(x: center.x, y: center.y)
    context.rotate(by: rotation)
    context.translateBy(x: -center.x, y: -center.y)

    let shadowRect = rect.offsetBy(dx: 0, dy: -rect.height * 0.04)
    context.setFillColor(NSColor(calibratedWhite: 0.0, alpha: shadowAlpha).cgColor)
    let shadowPath = NSBezierPath(roundedRect: shadowRect, xRadius: rect.width * 0.16, yRadius: rect.width * 0.16)
    shadowPath.fill()

    Palette.page.setFill()
    let pagePath = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.16, yRadius: rect.width * 0.16)
    pagePath.fill()

    Palette.pageShade.setStroke()
    pagePath.lineWidth = max(1.0, rect.width * 0.05)
    pagePath.stroke()

    context.restoreGState()
}

func drawBookmark(in context: CGContext, rect: CGRect) {
    Palette.ribbonShadow.setFill()
    let shadow = rect.offsetBy(dx: 0, dy: -rect.height * 0.05)
    drawRoundedRect(shadow, radius: rect.width * 0.45)

    Palette.ribbon.setFill()
    drawRoundedRect(rect, radius: rect.width * 0.45)

    let notch = NSBezierPath()
    notch.move(to: CGPoint(x: rect.minX, y: rect.minY + rect.height * 0.22))
    notch.line(to: CGPoint(x: rect.midX, y: rect.minY - rect.height * 0.15))
    notch.line(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.22))
    notch.close()
    Palette.ribbon.setFill()
    notch.fill()
}

func drawAccentLine(_ rect: CGRect) {
    let line = NSBezierPath(roundedRect: rect, xRadius: rect.height / 2, yRadius: rect.height / 2)
    Palette.accent.setFill()
    line.fill()
}

func writeIcon(size: CGFloat, outputURL: URL) throws {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(size),
        pixelsHigh: Int(size),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw NSError(domain: "generate-icons", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法创建位图"])
    }

    guard let graphicsContext = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "generate-icons", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法创建绘图上下文"])
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphicsContext

    guard let context = NSGraphicsContext.current?.cgContext else {
        throw NSError(domain: "generate-icons", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法获取 CoreGraphics 上下文"])
    }

    context.setAllowsAntialiasing(true)
    context.setShouldAntialias(true)

    let canvas = CGRect(x: 0, y: 0, width: size, height: size)
    let outer = canvas.insetBy(dx: size * 0.07, dy: size * 0.07)
    let corner = size * 0.22

    let bgPath = NSBezierPath(roundedRect: outer, xRadius: corner, yRadius: corner)
    bgPath.addClip()

    let gradient = NSGradient(starting: Palette.backgroundTop, ending: Palette.backgroundBottom)
    gradient?.draw(in: outer, angle: -45)

    Palette.highlight.setFill()
    let highlight = NSBezierPath(ovalIn: CGRect(x: outer.minX - size * 0.02, y: outer.midY, width: size * 0.65, height: size * 0.42))
    highlight.fill()

    let pageWidth = size * 0.24
    let pageHeight = size * 0.40
    let pageY = size * 0.28
    let leftPage = CGRect(x: size * 0.24, y: pageY, width: pageWidth, height: pageHeight)
    let rightPage = CGRect(x: size * 0.52, y: pageY, width: pageWidth, height: pageHeight)

    drawBookPage(in: context, rect: leftPage, rotation: -0.12, shadowAlpha: 0.14)
    drawBookPage(in: context, rect: rightPage, rotation: 0.12, shadowAlpha: 0.14)

    context.setStrokeColor(NSColor(calibratedWhite: 1.0, alpha: 0.48).cgColor)
    context.setLineWidth(max(1.0, size * 0.018))
    context.move(to: CGPoint(x: size * 0.50, y: size * 0.27))
    context.addLine(to: CGPoint(x: size * 0.50, y: size * 0.67))
    context.strokePath()

    drawBookmark(in: context, rect: CGRect(x: size * 0.455, y: size * 0.56, width: size * 0.09, height: size * 0.23))
    drawAccentLine(CGRect(x: size * 0.26, y: size * 0.20, width: size * 0.48, height: max(1.8, size * 0.05)))

    NSGraphicsContext.restoreGraphicsState()

    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "generate-icons", code: 2, userInfo: [NSLocalizedDescriptionKey: "无法导出 PNG"])
    }

    try png.write(to: outputURL)
}

let fileManager = FileManager.default
let cwd = URL(fileURLWithPath: fileManager.currentDirectoryPath)
let iconsDir = cwd.appendingPathComponent("icons", isDirectory: true)

let targets: [(CGFloat, String)] = [
    (16, "icon16.png"),
    (48, "icon48.png"),
    (128, "icon128.png")
]

for (size, name) in targets {
    try writeIcon(size: size, outputURL: iconsDir.appendingPathComponent(name))
    print("generated \(name)")
}