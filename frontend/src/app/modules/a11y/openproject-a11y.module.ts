// -- copyright
// OpenProject is an open source project management software.
// Copyright (C) 2012-2020 the OpenProject GmbH
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License version 3.
//
// OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
// Copyright (C) 2006-2013 Jean-Philippe Lang
// Copyright (C) 2010-2013 the ChiliProject Team
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
//
// See docs/COPYRIGHT.rdoc for more details.
// ++    Ng1FieldControlsWrapper,


import {FormsModule} from "@angular/forms";
import {APP_INITIALIZER, NgModule} from "@angular/core";
import {AccessibleClickDirective} from "core-app/modules/a11y/accessible-click.directive";
import {AccessibleByKeyboardComponent} from "core-app/modules/a11y/accessible-by-keyboard.component";
import {initializeKeyboardShortcuts, KeyboardShortcutService} from "core-app/modules/a11y/keyboard-shortcut-service";
import {CommonModule} from "@angular/common";
import {DoubleClickOrTapDirective} from "core-app/modules/a11y/double-click-or-tap.directive";

@NgModule({
  imports: [
    FormsModule,
    CommonModule,
  ],
  exports: [
    AccessibleClickDirective,
    DoubleClickOrTapDirective,
    AccessibleByKeyboardComponent,
  ],
  providers: [
    KeyboardShortcutService,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeKeyboardShortcuts,
      deps: [KeyboardShortcutService],
      multi: true
    }
  ],
  declarations: [
    AccessibleClickDirective,
    AccessibleByKeyboardComponent,
    DoubleClickOrTapDirective,
  ]
})
export class OpenprojectAccessibilityModule { }


