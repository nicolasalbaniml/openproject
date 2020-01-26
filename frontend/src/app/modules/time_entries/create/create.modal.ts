import {Component, ElementRef, Inject, ChangeDetectorRef, ViewChild, ChangeDetectionStrategy} from "@angular/core";
import {OpModalComponent} from "app/components/op-modals/op-modal.component";
import {OpModalLocalsToken} from "app/components/op-modals/op-modal.service";
import {OpModalLocalsMap} from "app/components/op-modals/op-modal.types";
import {I18nService} from "core-app/modules/common/i18n/i18n.service";
import {HalResourceEditingService} from "core-app/modules/fields/edit/services/hal-resource-editing.service";
import {TimeEntryResource} from "core-app/modules/hal/resources/time-entry-resource";
import {HalResource} from "core-app/modules/hal/resources/hal-resource";
import {TimeEntryFormComponent} from "core-app/modules/time_entries/form/form.component";

@Component({
  templateUrl: './create.modal.html',
  styleUrls: ['../edit/edit.modal.sass'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    HalResourceEditingService
  ]
})
export class TimeEntryCreateModal extends OpModalComponent {

  @ViewChild('editForm', { static: true }) editForm:TimeEntryFormComponent;

  text = {
    title: this.i18n.t('js.time_entry.create'),
    create: this.i18n.t('js.label_create'),
    close: this.i18n.t('js.button_close'),
    cancel: this.i18n.t('js.button_cancel')
  };

  public closeOnEscape = false;
  public closeOnOutsideClick = false;

  public createdEntry:TimeEntryResource;

  constructor(readonly elementRef:ElementRef,
              @Inject(OpModalLocalsToken) readonly locals:OpModalLocalsMap,
              readonly cdRef:ChangeDetectorRef,
              readonly i18n:I18nService,
              readonly halEditing:HalResourceEditingService) {
    super(locals, cdRef, elementRef);
  }

  public get entry() {
    return this.locals.entry;
  }

  public createEntry() {
    this.editForm.save()
      .then(() => {
        this.service.close();
      });
  }

  public setModifiedEntry($event:{savedResource:HalResource, isInital:boolean}) {
    this.createdEntry = $event.savedResource as TimeEntryResource;
  }
}
