import * as core from '@actions/core';

import * as fs from 'fs';
import { exec, spawn } from 'child_process';
import 'node-fetch'
import * as https from 'https'

import {
    BUILD_TOOLS_URL,
    BUILDS_PAPER,
    BUILDS_PURPUR,
    BUILDS_VELOCITY,
    BUILDS_WATERFALL,
    current, HTTP_HEADERS,
    runtimes
} from '../assets/runtime.js';
import * as versions from '../assets/versions/minecraft.js';
import * as versionsVelocity from "../assets/versions/velocity.js";

export function getRuntime() {
    let runtime = runtimes[current];
    if (!runtime) throw new TypeError(`Runtime ${current} not found`);

    return runtime;
}


export function loadServer(callback) {
    const runtime = getRuntime()
    const folder = fs.mkdtempSync('testmc-server-')

    if (runtime === 'velocity') {
        if (!versionsVelocity.isAvailable(versions.current))
            throw new TypeError(`Version ${versions.current} not found`);
    } else {
        if (!versions.isAvailable(versions.current))
            throw new TypeError(`Version ${versions.current} not found`);
    }

    switch (runtime['download'] ?? 'url') {
        case 'buildtools': {
            const buildtools = `${folder}/buildtools`
            fs.mkdirSync(buildtools)

            const jar = fs.createWriteStream(`${buildtools}/BuildTools.jar`)
            const flags = runtime['flags']
                .replaceAll('{version}', versions.current)

            https.get(BUILD_TOOLS_URL, { headers: HTTP_HEADERS }, res => {
                res.pipe(jar)

                jar.on('finish', () => {
                    jar.close()

                    const exec = spawn('java', ['-jar', 'BuildTools.jar', ...flags.split(' ')], {
                        cwd: buildtools,
                        detached: true,
                        stdio: 'inherit'
                    })

                    exec.on('exit', () => {
                        fs.cpSync(`${buildtools}/${runtime['output'].replaceAll('{version}', versions.current)}`, `${folder}/server.jar`)
                        callback(folder)
                    })
                })
            })

            break;
        }
        case 'git': {
            const git = `${folder}/git`
            fs.mkdirSync(git)
            const repo = runtime['url']
            const target = runtime['output']

            exec(`git clone ${repo} ${git}`, (error, _, stderr) => {
                if (error) throw error;
                if (stderr) throw new Error(stderr);

                const copy = () => {
                    const exec = spawn(runtime['exec'], {
                        cwd: git,
                        detached: true,
                        stdio: 'inherit'
                    })

                    exec.on('exit', () => {
                        fs.cpSync(`${git}/${target}`, `${folder}/server.jar`)
                        callback(folder)
                    })
                }

                if (runtime['versions'][versions.current])
                    exec(`git checkout ${runtime['versions'][versions.current]}`, (error, _, stderr) => {
                        if (error) throw error;
                        if (stderr) throw new Error(stderr);

                        copy()
                    })
                else
                    copy()
            })
            break;
        }
        case 'url': {
            let buildsUrl = ""
            let paper = true
            switch (current) {
                case "paper": {
                    buildsUrl = BUILDS_PAPER.replaceAll('{version}', versions.current)
                    break;
                }
                case "purpur": {
                    buildsUrl = BUILDS_PURPUR.replaceAll('{version}', versions.current)
                    paper = false
                    break;
                }
                case "waterfall": {
                    buildsUrl = BUILDS_WATERFALL.replaceAll('{version}', versions.current)
                    break;
                }
                case "velocity": {
                    buildsUrl = BUILDS_VELOCITY.replaceAll('{version}', versions.current)
                    break;
                }
                default: {
                    throw new TypeError(`Download method ${runtime['download']} not found: Could not find {build} for ${current}`);
                }
            }

            fetch(buildsUrl, { headers: HTTP_HEADERS })
                .then(res => res.json())
                .then(json => {
                    let build
                    if (paper) {
                        const builds = json['builds']
                        build = builds.reduce((acc, current) => {
                            if (current.channel === "default" ) return current;
                            return acc;
                        }, null)['build'];
                    } else
                        build = Number(json['builds']['latest'])

                    const url = runtime['url']
                        .replaceAll('{version}', versions.current)
                        .replaceAll('{build}', build)

                    const jar = fs.createWriteStream(`${folder}/server.jar`)

                    https.get(url, { headers: HTTP_HEADERS },res => {
                        res.pipe(jar)

                        jar.on('finish', () => {
                            jar.close()
                            callback(folder)
                        })
                    })
            })

            break;
        }
        default: {
            throw new TypeError(`Download method ${runtime['download']} not found: Invalid Runtime ${current}`);
        }
    }
}

export function startServer(folder) {
    const flags = core.getInput('flags')

    return spawn('java', ['-jar', 'server.jar', 'nogui', ...flags.split(' ')], {
        cwd: folder,
        detached: true,
        stdio: 'inherit'
    })
}