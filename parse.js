let fs = require("fs");
let readline = require("readline");

let Database = require("better-sqlite3");
let db = new Database("./data/blender-opendata.db");

/**
 * Iterate over a blender benchmark export file and write device info to DB.
 *
 * @param {ReadableStream} fileStream The exported blender JSONL file
 */
async function processLineByLine(fileStream) {
	let sceneTimes = [],
		lineNum = 0;

	// The file is a JSON-L file so it should be processed line-by-line
	let rl = readline.createInterface({ input: fileStream });

	let startProcess = new Date().getTime();
	for await (let line of rl) {
		let benchmark = JSON.parse(line);
		if (
			benchmark.schema_version === "v1" ||
			benchmark.schema_version === "v2"
		) {
			let scenes = benchmark.data.scenes;
			scenes.forEach(scene => {
				if (scene.stats.result === "OK") {
					let dev =
						benchmark.schema_version === "v1"
							? benchmark.data.device_info.compute_devices[0]
							: benchmark.data.device_info.compute_devices[0]
									.name;

					if (dev === "") {
						return;
					}

					lineNum++;

					sceneTimes.push({
						device: dev,
						type: benchmark.data.device_info.device_type,
						scene: scene.name,
						time: scene.stats.total_render_time
					});
				}
			});
		} else {
			let launches = benchmark.data;
			launches.forEach(run => {
				let dev = run.device_info.compute_devices[0].name;

				if (dev === "") {
					return;
				}

				lineNum++;

				sceneTimes.push({
					device: dev,
					type: run.device_info.compute_devices[0].type,
					scene: run.scene.label,
					time: run.stats.total_render_time
				});
			});
		}
	}
	console.log(
		`Processed \x1b[35m${lineNum}\x1b[0m lines in \x1b[32m${
			new Date().getTime() - startProcess
		}\x1b[0mms`
	);
	return [lineNum, sceneTimes];
}

(async () => {
	try {
		let fileStream = fs.createReadStream("./data/raw.jsonl");

		// inserting values into the db goes much faster when inside a
		// transaction
		let createTable = db.prepare(`CREATE TABLE IF NOT EXISTS blender (
				device TEXT,
				type TEXT,
				scene TEXT,
				time REAL
			)`);

		createTable.run();
		let deleteRows = db.prepare(`DELETE FROM blender`);
		deleteRows.run();
		let putRow = db.prepare("INSERT INTO blender VALUES (?,?,?,?)");

		let [sceneTmLen, sceneTimes] = await processLineByLine(fileStream);
		fs.writeFile("./data/parsed.json", JSON.stringify(sceneTimes), () => {
			console.log("Wrote \x1b[33mdata/parsed.json\x1b[0m");
		});

		// The inserting seems to go much faster inside a transaction
		let insert = db.transaction(trials => {
			for (let trial of trials) {
				putRow.run(
					trial["device"],
					trial["type"],
					trial["scene"],
					trial["time"]
				);
			}
		});

		let startWrite = new Date().getTime();
		insert(sceneTimes);
		console.log(
			`Wrote \x1b[35m${sceneTmLen}\x1b[0m lines to db in \x1b[32m${
				new Date().getTime() - startWrite
			}\x1b[0mms`
		);
	} catch (err) {
		console.error(err);
	}
})();
