export const examples = [
    { file: '01.html', title: '01 - A ray between two points', description: 'Casts one ray between two points and reports what stops it.' },
    { file: '02.html', title: '02 - Every contact along a ray', description: 'Reports every wall along a ray, not only the first one.' },
    { file: '03.html', title: '03 - Two sources at once', description: 'Casts against a tile grid and loose rectangles at the same time.' },
    { file: '04.html', title: '04 - A fan of rays', description: 'Casts two hundred rays around a point to draw what it can see.' },
    { file: '05.html', title: '05 - Moving a rectangle', description: 'Moves a rectangle through the map with rays from its leading edge.' },
    { file: '06.html', title: '06 - A ray that bounces', description: 'Reflects a ray off every surface it meets until its budget runs out.' },
    { file: '07.html', title: '07 - Definitions and filters', description: 'Casts the same ray three times with three different filters.' },
    { file: '08.html', title: '08 - Fog of war', description: 'Remembers which cells have already been seen.' },
    { file: '09.html', title: '09 - Thin walls and one-way surfaces', description: 'Shows the difference between thin geometry and a one-way rule.' },
    { file: '10.html', title: '10 - A cone of vision', description: 'Checks whether a guard can see a box inside its vision cone.' }
];


export function renderMenu(id, current) {
    const here = current || window.location.pathname.split('/').pop();
    const holder = document.getElementById(id);
    const select = document.createElement('select');

    for (var i = 0; i < examples.length; i++) {
        const option = document.createElement('option');
        option.value = examples[i].file;
        option.textContent = examples[i].title;
        option.selected = examples[i].file === here;
        select.appendChild(option);
    }

    select.addEventListener('change', function () {
        window.location.href = select.value;
    });

    holder.innerHTML = '';
    holder.appendChild(select);
}

export function renderTable(id, rows) {
    document.getElementById(id).innerHTML = '<table>' + rows.map(function (row) {
        const span = Math.floor(4 / row.length);
        return '<tr>' + row.map(function (field) {
            return '<td colspan="' + span + '"><span class="name">' + field[0] + '</span>' + field[1] + '</td>';
        }).join('') + '</tr>';
    }).join('') + '</table>';
}

export function round(value) {
    return String(Math.round(value * 100) / 100);
}

export function cellOf(point, grid) {
    return Math.floor(point.x / grid.tileSize) + ', ' + Math.floor(point.y / grid.tileSize);
}

export function faceName(hit) {
    if (hit.normalY < 0) {
        return 'top face';
    }
    if (hit.normalY > 0) {
        return 'bottom face';
    }
    if (hit.normalX < 0) {
        return 'left face';
    }
    return 'right face';
}