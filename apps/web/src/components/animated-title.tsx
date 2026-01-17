import { useEffect, useState } from "react";

const TITLE_LINES = [
	" ██╗  ██╗ █████╗ ██╗",
	" ╚██╗██╔╝██╔══██╗██║",
	"  ╚███╔╝ ███████║██║",
	"  ██╔██╗ ██╔══██║██║",
	" ██╔╝ ██╗██║  ██║██║",
	" ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝",
	"",
	" ██████╗  █████╗ ████████╗ █████╗",
	" ██╔══██╗██╔══██╗╚══██╔══╝██╔══██╗",
	" ██║  ██║███████║   ██║   ███████║",
	" ██║  ██║██╔══██║   ██║   ██╔══██║",
	" ██████╔╝██║  ██║   ██║   ██║  ██║",
	" ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝",
	"",
	"  █████╗ ███╗   ██╗ █████╗ ██╗  ██╗   ██╗███████╗████████╗",
	" ██╔══██╗████╗  ██║██╔══██╗██║  ╚██╗ ██╔╝██╔════╝╚══██╔══╝",
	" ███████║██╔██╗ ██║███████║██║   ╚████╔╝ ███████╗   ██║",
	" ██╔══██║██║╚██╗██║██╔══██║██║    ╚██╔╝  ╚════██║   ██║",
	" ██║  ██║██║ ╚████║██║  ██║███████╗██║   ███████║   ██║",
	" ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝╚═╝   ╚══════╝   ╚═╝",
];

export function AnimatedTitle() {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setTick((t) => t + 1);
		}, 80);
		return () => clearInterval(interval);
	}, []);

	return (
		<pre className="select-none overflow-x-auto font-mono text-sm">
			{TITLE_LINES.map((line, lineIndex) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: Static array, order never changes
				<div key={lineIndex} className="flex">
					{line.split("").map((char, charIndex) => {
						const wave = Math.sin(
							(tick + charIndex * 0.3 + lineIndex * 2) * 0.15,
						);
						const brightness = 0.5 + wave * 0.5;
						return (
							<span
								// biome-ignore lint/suspicious/noArrayIndexKey: Static array, order never changes
								key={charIndex}
								style={{
									opacity: char === " " ? 0 : 0.4 + brightness * 0.6,
									textShadow:
										brightness > 0.7 ? "0 0 8px currentColor" : "none",
									transition: "opacity 0.1s, text-shadow 0.1s",
								}}
							>
								{char}
							</span>
						);
					})}
				</div>
			))}
		</pre>
	);
}
