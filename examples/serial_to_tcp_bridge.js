#!/usr/bin/env node
/**
 * Serial to TCP Bridge for MeshCore devices
 * 
 * This script bridges a serial USB MeshCore device to TCP, allowing remote access
 * via TCP connections. Multiple TCP clients can connect simultaneously.
 * 
 * Usage:
 *     node serial_to_tcp_bridge.js [--serial-port PORT] [--tcp-host HOST] [--tcp-port PORT]
 * 
 * Example:
 *     node serial_to_tcp_bridge.js --serial-port /dev/ttyUSB0 --tcp-port 5000
 */

import { createServer } from 'net';
import NodeJSSerialConnection from '../src/connection/nodejs_serial_connection.js';
import { SerialPort } from 'serialport';

const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
    const index = args.indexOf(flag);
    return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const serialPort = getArg('--serial-port', '/dev/ttyUSB0');
const tcpHost = getArg('--tcp-host', '0.0.0.0');
const tcpPort = parseInt(getArg('--tcp-port', '5000'));

console.log(`Starting Serial to TCP Bridge`);
console.log(`Serial: ${serialPort}`);
console.log(`TCP: ${tcpHost}:${tcpPort}`);

// Create serial port connection
const serialPortInstance = new SerialPort({
    path: serialPort,
    baudRate: 115200,
    autoOpen: false
});

// Set of connected TCP clients
const tcpClients = new Set();

// Handle serial data - forward to all TCP clients
serialPortInstance.on('data', (data) => {
    if (tcpClients.size > 0) {
        const deadClients = [];
        for (const client of tcpClients) {
            try {
                if (!client.destroyed) {
                    client.write(data);
                }
            } catch (error) {
                console.error(`Error writing to TCP client: ${error.message}`);
                deadClients.push(client);
            }
        }
        // Remove dead clients
        deadClients.forEach(client => {
            tcpClients.delete(client);
            try {
                client.destroy();
            } catch (e) {
                // Ignore
            }
        });
    }
});

serialPortInstance.on('error', (error) => {
    console.error(`Serial port error: ${error.message}`);
});

serialPortInstance.on('close', () => {
    console.log('Serial port closed');
});

// Open serial port
serialPortInstance.open((error) => {
    if (error) {
        console.error(`Failed to open serial port: ${error.message}`);
        process.exit(1);
    }
    console.log(`Serial port opened: ${serialPort}`);
});

// Create TCP server
const server = createServer((socket) => {
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`TCP client connected: ${clientAddr}`);
    tcpClients.add(socket);

    // Forward TCP data to serial
    socket.on('data', (data) => {
        if (serialPortInstance.isOpen) {
            serialPortInstance.write(data);
        } else {
            console.warn('Serial port not open, dropping TCP data');
        }
    });

    socket.on('error', (error) => {
        console.error(`TCP client error (${clientAddr}): ${error.message}`);
    });

    socket.on('close', () => {
        console.log(`TCP client disconnected: ${clientAddr}`);
        tcpClients.delete(socket);
    });
});

server.on('error', (error) => {
    console.error(`TCP server error: ${error.message}`);
});

server.listen(tcpPort, tcpHost, () => {
    const addr = server.address();
    console.log(`TCP server started on ${addr.address}:${addr.port}`);
    console.log(`Connect to this bridge using: meshcli -t ${addr.address} -p ${addr.port} <command>`);
});

// Handle shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    serialPortInstance.close();
    tcpClients.forEach(client => {
        try {
            client.destroy();
        } catch (e) {
            // Ignore
        }
    });
    server.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    serialPortInstance.close();
    tcpClients.forEach(client => {
        try {
            client.destroy();
        } catch (e) {
            // Ignore
        }
    });
    server.close();
    process.exit(0);
});


